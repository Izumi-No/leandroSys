# leandroSys — app de desktop (Electron, cliente fino do printd)

> **O que é:** a **UI** da impressão. Ela **não** drena fila nem fala com a API de
> negócio: quem faz isso é o daemon [`apps/printd`](../printd/README.md) (em Go, dono da
> fila, com Bluetooth via socket nativo do kernel). O Electron conversa com o daemon por
> `http://127.0.0.1:7411` e, se ele não estiver respondendo, **sobe o binário desanexado**
> — fechar a janela não para a impressão, porque o daemon continua vivo como serviço.

Com a fila fora do processo do Electron, o painel ficou simples: a configuração (API +
credencial do agente) é **digitada uma vez** e o dia a dia é **escolher o dispositivo
descoberto** (Bluetooth, USB ou rede) e **atreler uma fila já cadastrada no admin**. A
UI não cria impressora e não tem código de pareamento.

---

## 1. Arquitetura

![Arquitetura: daemon + Electron](../../docs/diagrams/desktop-arquitetura.svg)

| peça | arquivo | responsabilidade |
|---|---|---|
| gerenciador do daemon | `src/daemon.ts` | lê porta/token do `printd.json`, pinga `/estado`, spawna o binário se preciso |
| main | `src/main.ts` | janela, IPC (`desktop:*`), poll de 1s do `/estado` empurrado ao renderer |
| preload | `src/preload.ts` + `src/preload-api.ts` | `contextBridge` → `window.leandro`; único caminho renderer↔main |
| renderer | `renderer/*` | UI: configuração (1x), descoberta local (BT/USB/rede), atrelamento de fila, filas atreladas, log |

O renderer **não tem token nem `fetch`**: ele só manda intenções por IPC e observa o
snapshot que o main busca no daemon a cada segundo.

## 2. Daemon: sobe sozinho, sobrevive à UI

`src/daemon.ts` faz o papel de launcher:

1. lê `~/.config/leandrosys/printd.json` (respeita `PRINTD_CONFIG`/`XDG_CONFIG_HOME`)
   para achar **porta** e **token**;
2. pinga `GET /estado` com `X-Printd-Token`;
3. se ninguém respondeu, tenta os candidatos `PRINTD_BIN` → `../printd/bin/printd`
   (dev) → `apps/printd/bin/printd` (cwd) → `printd` (PATH) e espera ele responder;
4. o spawn é **desanexado** (`detached` + `unref` + `stdio: ignore`): o daemon vira um
   processo da máquina e continua imprimindo com o app fechado (sem risco de SIGPIPE
   no terminal morto).

Se cair no meio do caminho, o poll de 1s tenta reerguer (com intervalo mínimo de 5s
entre tentativas); a UI mostra o painel "daemon offline" com o botão **Iniciar daemon**.

## 3. O que a UI oferece

| tela | quando | o que faz |
|---|---|---|
| Configuração | enquanto `configurado: false` | API + usuário/senha do agente → `POST /config` (o daemon valida antes de gravar) |
| Impressoras disponíveis | depois de configurado | **Bluetooth**: `/dispositivos?scan=1` (~10s); **USB**: `/dispositivos/usb`; **Rede**: `host[:porta]` — escolher um abre o painel de atrelamento |
| Atrelar fila | ao escolher um dispositivo | lista as filas do admin (`GET /filas`, com o agente atual), escolhe uma livre → `POST /atrelar {printerId, endereco, transporte, baud?}` |
| Filas atreladas | sempre | estado por fila (ociosa/imprimindo/backoff…), contadores ✓/⚠, `lastError`, **Cupom de teste** e **Desatrelar** |
| Log | sempre | as últimas linhas do log do daemon (via `/estado`) |

Filas atreladas a **outro** agente aparecem na lista, mas ficam desabilitadas
(`agentName` mostra quem tem). A fila continua sendo criada e administrada no admin —
aqui só se liga o hardware local.

## 4. Contrato com o daemon (`window.leandro`)

| método | caminho do daemon |
|---|---|
| `estado()` / `onEstado()` | `GET /estado` (poll de 1s do main) |
| `salvarConfig(config)` | `POST /config` |
| `filas()` | `GET /filas` (filas do admin + agente vinculado) |
| `atrelar({printerId, endereco, transporte, baud?})` | `POST /atrelar` |
| `desatrelar(printerId)` | `POST /desatrelar` |
| `buscaBt(scan)` | `GET /dispositivos?scan=1` |
| `buscaUsb()` | `GET /dispositivos/usb` |
| `testar(id)` | `POST /impressoras/:id/teste` |
| `iniciarDaemon()` | — (launcher local) |

Os tipos vivem em `src/preload-api.ts` e espelham a resposta do daemon.

## 5. Segurança

- `contextIsolation: true`, `nodeIntegration: false` — e agora dá para manter o sandbox
  ligado, já que o preload não precisa de Node (não há mais módulo nativo de Bluetooth).
- O renderer não vê token: toda chamada passa por IPC; o token do daemon é lido do
  arquivo pelo main (mesmo usuário do disco, arquivo `0600`).
- O daemon só escuta em `127.0.0.1` e exige `X-Printd-Token` em cada rota.

## 6. Desenvolvimento

```bash
pnpm --filter @leandrosys/desktop dev        # build do printd + esbuild + electron
pnpm --filter @leandrosys/desktop typecheck
```

O smoke E2E da impressão é o do daemon (o Electron não transmite nada):
`pnpm --filter @leandrosys/printd smoke`.

| env | papel | padrão |
|---|---|---|
| `PRINTD_BIN` | binário do daemon a spawnar | candidatos de `src/daemon.ts` |
| `PRINTD_CONFIG` | caminho do `printd.json` | `~/.config/leandrosys/printd.json` |

## 7. Referências

- Daemon (drena a fila, transportes, smoke): [`apps/printd/README.md`](../printd/README.md)
- Fluxo completo e garantias: [`docs/fluxo.md`](../../docs/fluxo.md)
- Contrato da API (attach/detach/claim com `agentId`): [`apps/api/README.md`](../api/README.md)
