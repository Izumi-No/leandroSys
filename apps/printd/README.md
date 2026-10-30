# leandroSys — printd (daemon de impressão em Go)

> **O que é:** o daemon que **é o dono da fila** no formato do "edge-printer" do
> tablemanager: drena o `claim` de todas as filas atreladas a esta máquina, transmite os
> bytes e manda o `ack` — um worker por fila, em paralelo. Ele expõe uma **API local em
> `127.0.0.1:7411`** e é o que o Electron (`apps/desktop`) conversa: o app de desktop é
> só um cliente de UI.
>
> Zero dependência externa em Go (só stdlib) e **sem módulo nativo**: o Bluetooth usa o
> socket RFCOMM do próprio kernel (`AF_BLUETOOTH` via `syscall`) e o USB usa `termios`
> do próprio kernel — não existe a dor de ABI/compilação do mundo Electron.

Um pedido de cozinha com rota para duas filas sai **nas duas vias** (fan-out), e o
printd drena as duas em paralelo — comprovado por `pnpm --filter @leandrosys/printd smoke`.

---

## 1. Arquitetura

![Arquitetura: daemon + Electron](../../docs/diagrams/desktop-arquitetura.svg)

| peça | arquivo | responsabilidade |
|---|---|---|
| entry | `cmd/printd/main.go` | flags, boot, banner `printd pronto addr=… token=…` |
| API local | `internal/server` | `/estado` `/config` `/dispositivos` `/dispositivos/usb` `/filas` `/atrelar` `/desatrelar` `/impressoras/:id/teste` |
| concentrador | `internal/agent` | goroutine por fila: claim → transmitir → ack (dedup, backoff) + reconciliação |
| cliente da API | `internal/api` | REST leandroSys: login sob demanda (401 → login → repete), attach/detach com `agentId` |
| transportes | `internal/transport` | rede (TCP), Bluetooth (RFCOMM nativo) e USB (serial 8N1 via `termios` ou `/dev/usb/lp*`) |
| BlueZ | `internal/bluez` | `bluetoothctl` (conhecidos), `hcitool scan` (varredura), `sdptool` (canal RFCOMM) — tudo **sem root** |
| persistência | `internal/config` | `printd.json` (token, identidade do agente, API, credenciais, filas atreladas) |

O daemon é **independente do Electron**: roda sozinho (`pnpm --filter @leandrosys/printd
start`) e continua imprimindo mesmo com a UI fechada — o Electron só o sobe se não
estiver respondendo (spawn desanexado).

## 2. Atrelar uma fila existente a um dispositivo local

**Não existe criação de impressora por aqui.** A fila (nome, colunas, codepage, destino
da conta, rotas) é cadastrada no admin (`apps/web`, `POST /printers`). O daemon só
descobre o hardware e **atrela** a fila a um dispositivo desta máquina.

1. **Configuração, uma única vez:** `POST /config` com API + usuário/senha do agente
   (`impressora`). O daemon **testa as credenciais antes de gravar** (errada → `502` e
   nada é persistido). Não há código de pareamento.
2. **Descobrir dispositivos locais** (a UI lista os três):
   - Bluetooth: `GET /dispositivos` — conhecidos (`bluetoothctl devices`); com
     `?scan=1` junta uma varredura (`hcitool scan`, ~10s);
   - USB: `GET /dispositivos/usb` — portas seriais (`/dev/serial/by-id/*`,
     `/dev/ttyUSB*`, `/dev/ttyACM*`) e impressoras de classe printer
     (`/dev/usb/lp*`), deduplicadas e com o nome do produto (sysfs);
   - Rede: formulário `host[:porta]` (padrão 9100) na UI.
3. **Atrelar:** `POST /atrelar {printerId, endereco, transporte?, baud?}` — o
   transporte é inferido (`/dev/…` → USB, `AA:BB:CC:DD:EE:FF` → Bluetooth, IP → rede) e
   o daemon chama `POST /printers/:id/attach` na API com `agentId` + `agentName`
   (derivados de `/etc/machine-id` + hostname) e grava o vínculo local.

| situação | resposta |
|---|---|
| fila/dispositivo ausentes ou endereço inválido | `400` |
| fila inexistente na API | `404` |
| fila já atrelada a **outro** agente | `409` (a API recusa o attach) |
| API indisponível | `502` com a mensagem da API |
| sem token do daemon | `401` |

4. **Desatrelar:** `POST /desatrelar {printerId}` — limpa o vínculo na API (`POST
   /printers/:id/detach`) e remove do `printd.json`. A fila, as rotas e o histórico
   permanecem no admin.

**Reconciliação com a API (fonte de verdade):** no boot, após trocar a configuração e
quando um `claim` responde `409`/`404`, o agente chama `GET /printers` e:
- espelha no `printd.json` apenas as filas com `agentId === agente local`;
- instalações antigas (fila no config sem vínculo na API) são **auto-atreladas** na
  primeira reconciliação (migração);
- filas atreladas a outro agente ou apagadas no admin desaparecem daqui.

## 3. Ciclo operacional (por fila)

```text
1 worker (goroutine) por fila atrelada:
  1. POST /print-jobs/claim {printerId, agentId, limit: 8}
     ├─ jobs[] → para cada job, na ordem:
     │     · já impresso nesta sessão? → só reenvia ack (dedup, não reimprime)
     │     · data (base64) → bytes ESC/POS crus
     │     · transmite (1 job por vez — nunca intercala cupons)
     │     · POST /print-jobs/:id/ack {success, error?}   ← obrigatório até no erro
     ├─ vazio → dorme ~2s (± jitter)
     ├─ 409/404 (inativa/removida/desatrelada) → dorme 15s e **reconcilia**
     ├─ dispositivo USB ausente → dorme 15s **sem claim**
     └─ erro de rede/API → backoff exponencial ± jitter (teto 60s)
```

Garantias derivadas do fluxo (`docs/fluxo.md` §6–§7): **todo job recebido gera `ack`**;
o servidor é at-least-once, então o dedup por `job_id` evita reimpressão; e nunca há
`claim` sem transporte disponível (senão uma impressora sem hardware queimaria as 3
tentativas dos jobs. O `agentId` no claim é conferido contra o vínculo salvo na API —
outra máquina não consegue drenar a fila atrelada a esta.

## 4. Transportes

| transporte | implementação | estado |
|---|---|---|
| `NETWORK` | TCP para `host[:porta]` (padrão 9100), escrita e fechamento | **funcionando** |
| `BLUETOOTH` | SDP (`sdptool browse`) → socket `AF_BLUETOOTH`/`BTPROTO_RFCOMM` → connect → write | **funcionando** |
| `USB` | serial 8N1 via `termios` do kernel (baud configurável, padrão 9600, `tcdrain` antes de fechar) ou `write` direto em `/dev/usb/lp*` | **funcionando** |

No USB o worker **não faz claim se o dispositivo não existe agora** (`os.Stat` no char
device) — desplugou, ele espera sem queimar tentativas. O caminho preferido é
`/dev/serial/by-id/*` (estável entre replugadas); o usuário do daemon precisa estar no
grupo `dialout` para as portas seriais. Tudo isso é syscall pura: nenhum binding C, o
mesmo binário funciona em amd64/arm64.
**Bluetooth sem segredo:** `syscall.Socket(31, SOCK_STREAM, 3)` + a `sockaddr_rc`
montada à mão ({u16 family; u8[6] bdaddr little-endian; u8 channel}). O kernel devolve
`EINPROGRESS` mesmo em socket bloqueante (o link ACL é enfileirado), então a conexão é
completada com `select` + `SO_ERROR` sob prazo próprio — depois disso as escritas voltam
a ser bloqueantes. O smoke faz um **pré-voo** contra o kernel real: conectar num MAC
morto tem que dar erro de rede, nunca `invalid argument` (prova que a struct está
correta). Canal RFCOMM vem do SDP (`sdptool browse`, preferindo o perfil *Serial Port*).

## 5. Configuração e token

`~/.config/leandrosys/printd.json` (respeita `XDG_CONFIG_HOME`, criado no 1º start com
token de 16 bytes e modo `0600`):

```json
{
  "porta": 7411,
  "token": "…",
  "agenteId": "b3f1c2…",
  "agenteNome": "cozinha-pc",
  "apiUrl": "http://localhost:3001/api",
  "usuario": "impressora",
  "senha": "impressora123",
  "impressoras": [ { "id": "…", "nome": "Cozinha 1", "endereco": "192.168.0.10:9100", "transporte": "NETWORK", "colunas": 32, "codepage": 19 } ]
}
```

`agenteId` é o primeiro par de hex de `sha256(machine-id + hostname)` (fallback: token
aleatório persistido). É ele que a API usa para saber **quem** atrelou cada fila e para
recusar o claim de outra máquina.

Toda rota local exige o header `X-Printd-Token` (mesmo valor). Como o daemon escuta só
em `127.0.0.1` e não responde CORS, um site malicioso no navegador não consegue nem ler
resposta nem agir — e o Electron lê o token do arquivo (mesmo usuário do disco).

| flag | papel | padrão |
|---|---|---|
| `--config` | caminho do `printd.json` | `~/.config/leandrosys/printd.json` |
| `--porta` | porta do servidor local (persiste no config) | `7411` |
| `--api` | sobrescreve a API configurada | — |

## 6. Smoke E2E (sem interface)

```bash
# API em http://localhost:3001/api com seed aplicado
pnpm --filter @leandrosys/printd smoke
```

`cmd/smoke` sobe o daemon num config temporário e valida de ponta a ponta: pré-voo do
Bluetooth no kernel real → configuração (credenciais testadas) → **cria 2 filas no
admin e as atrela pelo daemon** (`POST /atrelar`) em 2 sinks TCP → rotas do mesmo
produto nas duas → comanda enviada (2 jobs) → drenagem paralela (as duas vias saem com
o mesmo pedido) → jobs `DONE` → desatrela e apaga as filas.

## 7. Estados expostos na UI

| estado | significado |
|---|---|
| `ociosa` | sem jobs, esperando o próximo poll |
| `imprimindo` | transmitindo um job |
| `backoff` | API indisponível; mostra quando tenta de novo |
| `sem-transporte` | dispositivo USB não encontrado agora (ou transporte sem suporte) |
| `parada` | fila inativa/removida/desatrelada no sistema (dispara reconciliação) |

Mais: contadores de impressos/falhas, último job + horário, `lastError`, e o log do
daemon (`/estado` devolve as 60 últimas linhas).

## 8. Desenvolvimento

```bash
pnpm --filter @leandrosys/printd build      # go build -o bin/printd ./cmd/printd
pnpm --filter @leandrosys/printd start      # roda o daemon (API no ar para drenar)
pnpm --filter @leandrosys/printd smoke      # E2E headless (§6)
pnpm --filter @leandrosys/printd typecheck  # go vet ./...
```

## 9. Referências

- Fluxo completo e garantias: [`docs/fluxo.md`](../../docs/fluxo.md)
- Cliente de UI: [`apps/desktop/README.md`](../desktop/README.md)
- Contrato da API (attach/detach/claim com `agentId`): [`apps/api/README.md`](../api/README.md)
- Base conceitual (at-least-once, dedup, backoff): `tablemanager/print-protocol.md` §6–§7
