# leandroSys — API (backend)

Sistema de comandas e mesas com fila de impressão por impressora (ESC/POS), rotas de
impressão por **categoria** ou por **item**, e painel administrativo (cadastro de mesas,
ocupação/liberação e gestão de comandas).

> Fonte da verdade da API: endpoints, motor de impressão, contrato de erros e modelo de
> dados. A estrutura do monorepo e os comandos gerais estão no `README.md` da raiz.
>
> **O caminho completo do pedido** (mesa → comanda → rotas → fila → `claim`/`ack` → conta) e
> as garantias/limitações da entrega estão em [`docs/fluxo.md`](../../docs/fluxo.md);
> a especificação do agente de impressão (daemon `printd`) está em
> [`apps/printd/README.md`](../printd/README.md) — a UI é o `apps/desktop`.

- **Runtime:** Node 22 + TypeScript
- **HTTP:** Hono (`@hono/node-server`)
- **Banco:** PostgreSQL 16 + Prisma 8 (RC) — contract em `src/prisma/contract.prisma`
- **Auth:** JWT (HS256, `hono/jwt`) com papéis
- **Impressão:** ESC/POS renderizado no backend, fila persistida em `PrintJob`, drenada
  pelo daemon `printd` (Go, `apps/printd` — UI fina no `apps/desktop`; sistema autocontido,
  sem gateway externo)

---

## 1. Rodando

Este pacote é o `apps/api` do monorepo (estrutura geral no `README.md` da raiz). Os
comandos abaixo são executados **na raiz**:

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # DATABASE_URL, JWT_SECRET, PORT, CORS_ORIGIN

pnpm contract:emit        # regenera contract.json / contract.d.ts do Prisma 8
pnpm db:update            # aplica o schema no banco
pnpm seed                 # usuários, cardápio, impressoras, rotas, mesas 1–10

pnpm dev                  # Next.js (3000) + API (3001) em paralelo
pnpm --filter ./apps/api dev   # só a API, com watch
pnpm start                # só a API, sem watch
pnpm typecheck            # tsc --noEmit em todos os pacotes
```

Base URL: `http://localhost:3001/api` (porta via `PORT`).
O `.env` fica em `apps/api/.env` e é lido a partir do diretório do pacote — rode os
sempre via `pnpm` (o CWD de cada script é o do pacote correspondente).

### Variáveis de ambiente

| Variável        | Padrão                 | Descrição                                  |
| --------------- | ---------------------- | ------------------------------------------ |
| `DATABASE_URL`  | —                      | Postgres dev na porta **5433** (container `leandrosys-db`) |
| `JWT_SECRET`    | `dev-secret`           | Segredo HS256 (obrigatório em produção)    |
| `PORT`          | `3001`                 | Porta da API                               |
| `CORS_ORIGIN`   | `http://localhost:3000`| Origem liberada (Next.js)                  |

### Seed (dados iniciais)

| Usuário     | Senha           | Papel    |
| ----------- | --------------- | -------- |
| `admin`     | `admin123`      | ADMIN    |
| `garcom`    | `garcom123`     | WAITER   |
| `caixa`     | `caixa123`      | CASHIER  |
| `cozinha`   | `cozinha123`    | CHEF     |
| `impressora`| `impressora123` | CHEF *(credencial do daemon `printd`, que drena a fila)* |

Impressoras: **Cozinha**, **Balcão** (`printsBill: true` — destino da conta), **Bar**.
Rotas: `Lanches/Porções/Pratos → Cozinha`, `Bebidas → Balcão` e
**item `Café Expresso` → Bar** (demonstra item vencendo categoria).

---

## 2. Autenticação

```http
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "admin123" }
```

```json
{ "token": "<jwt>", "user": { "id": "…", "username": "admin", "role": "ADMIN" } }
```

Envie em toda requisição autenticada:

```http
Authorization: Bearer <token>
```

Token válido por **7 dias**. Papéis e permissões:

| Middleware         | Papéis permitidos             | Onde vale                                  |
| ------------------ | ----------------------------- | ------------------------------------------ |
| `requireAuth`      | qualquer papel autenticado    | leituras (listas, detalhe, fila)           |
| `requireOperator`  | ADMIN, WAITER, CASHIER        | mesas, comandas, envio/fechamento          |
| `requireAdmin`     | ADMIN                         | cadastros, usuários, impressoras e rotas   |

- `CHEF` só lê (cardápio, comandas, fila) e drena jobs — não opera mesas/comandas.
- `POST /api/auth/users` etc. exige ADMIN.

---

## 3. Contrato de erro

Todo erro responde JSON:

```json
{ "error": "mensagem legível", "code": "CÓDIGO", "details": [ … ] }
```

| HTTP | `code`       | Quando                                                        |
| ---- | ------------ | ------------------------------------------------------------- |
| 400  | `BAD_REQUEST`| corpo/params/query inválidos (zod) ou regra de pré-condição   |
| 401  | `UNAUTHORIZED`| token ausente, inválido/expirado ou senha errada              |
| 403  | `FORBIDDEN`  | papel sem permissão                                           |
| 404  | `NOT_FOUND`  | id inexistente / rota inexistente                             |
| 409  | `CONFLICT`   | estado inválido (ex.: comanda fechada) e violações de integridade |
| 500  | `INTERNAL`   | erro não tratado (loga `[api] erro não tratado:`)             |

`details` só aparece em `400` de validação zod (`path` + `message`). Violações do Postgres
são mapeadas: `23505` → 409 *"Já existe um registro com esses dados"*, `23503` → 409
*"Registro em uso por outros dados"*, `23514` → 409 de validação.

Ids de rota são **UUID**; valor inválido → `400` com `details[0].path = "id"`.

---

## 4. Endpoints

> Todos abaixo têm prefixo `/api`. "Acesso" = papéis aceitos.

### 4.1 Auth e usuários (`/auth`)

| Método | Rota               | Acesso | Descrição |
| ------ | ------------------ | ------ | --------- |
| POST   | `/auth/login`      | público | Devolve `{ token, user }` |
| GET    | `/auth/me`         | autenticado | `{ user: { id, username, role } }` |
| GET    | `/auth/users`      | ADMIN | `{ users: [...] }` |
| POST   | `/auth/users`      | ADMIN | Cria usuário → `201 { user }` |
| GET    | `/auth/users/:id`  | ADMIN | `{ user }` |
| PATCH  | `/auth/users/:id`  | ADMIN | `{ password?, role? }` (ao menos um) |
| DELETE | `/auth/users/:id`  | ADMIN | Remove (não pode ser a si mesmo nem o último ADMIN) |

`POST /auth/users`:

```json
{ "username": "ana", "password": "123456", "role": "WAITER" }
```

`role ∈ ADMIN | WAITER | CASHIER | CHEF` · `username` 3–40 · `password` 6–100.

### 4.2 Catálogo

| Método | Rota                     | Acesso | Corpo |
| ------ | ------------------------ | ------ | ----- |
| GET    | `/categories`            | autenticado | `?includeInactive=true` |
| POST   | `/categories`            | ADMIN | `{ name, active? }` → `201` |
| PATCH  | `/categories/:id`        | ADMIN | `{ name?, active? }` |
| DELETE | `/categories/:id`        | ADMIN | 409 se houver produtos |
| GET    | `/products`              | autenticado | `?categoryId=&includeInactive=` → inclui `category` |
| POST   | `/products`              | ADMIN | `{ name, price, categoryId, active? }` → `201` |
| PATCH  | `/products/:id`          | ADMIN | campos parciais |
| DELETE | `/products/:id`          | ADMIN | |
| GET    | `/aditionals`            | autenticado | `?includeInactive=` |
| POST   | `/aditionals`            | ADMIN | `{ name, price, active? }` → `201` |
| PATCH  | `/aditionals/:id`        | ADMIN | campos parciais |
| DELETE | `/aditionals/:id`        | ADMIN | |

`price` aceita número (`0 … 99999`) e é devolvido como número com 2 casas.

### 4.3 Mesas

| Método | Rota                      | Acesso | Descrição |
| ------ | ------------------------- | ------ | --------- |
| GET    | `/tables`                 | autenticado | Mapa do salão (ver abaixo) |
| POST   | `/tables`                 | ADMIN | `{ number, capacity?, label? }` → `201 { table: { id } }` |
| PATCH  | `/tables/:id`             | ADMIN | `{ number?, capacity?, label? }` |
| DELETE | `/tables/:id`             | ADMIN | |
| POST   | `/tables/:id/take`        | operador | Ocupa mesa **e abre comanda** → `201 { comanda }` |
| POST   | `/tables/:id/transfer`    | operador | `{ toTableId }` → `{ transfer }` |
| POST   | `/tables/:id/reserve`     | operador | `{ reserved: true }` |
| DELETE | `/tables/:id/reserve`     | operador | Cancela reserva → `{ reserved: false }` |
| POST   | `/tables/:id/release`     | operador | Fecha comanda e libera → `{ released, comandaId, warnings }` |

`GET /tables` → `{ tables: [ { id, number, capacity, label, status, comanda } ] }`, onde
`comanda` é `null` ou `{ id, number, status, openedAt, waiter, total, itemCount, pendingItems }`.
`status ∈ AVAILABLE | RESERVED | OCCUPIED`.

`POST /tables/:id/take` aceita `{ "waiterId": "<uuid>" | null }` (opcional — quando omitido,
a comanda fica sem atendente). Erros: `409` se a mesa já estiver ocupada (`OCCUPIED`) ou
reservada (`RESERVED`).

`release` aceita `{ "paymentMethod": "MONEY" | "CARD" | "PIX" | "OTHER" }` opcional.

### 4.4 Comandas

| Método | Rota                                   | Acesso | Descrição |
| ------ | -------------------------------------- | ------ | --------- |
| GET    | `/comandas`                            | autenticado | `?status=OPEN\|PAYING\|CLOSED` → resumos |
| POST   | `/comandas`                            | operador | `{ tableId, waiterId? }` → `201 { comanda }` |
| GET    | `/comandas/:id`                        | autenticado | detalhe com `items[]` |
| POST   | `/comandas/:id/items`                  | operador | `{ productId, quantity?, note?, aditionalIds? }` → `201 { comanda }` |
| PATCH  | `/comandas/:id/items/:itemId`          | operador | `{ quantity?, note?, status? }` |
| DELETE | `/comandas/:id/items/:itemId`          | operador | `{ result: "REMOVED" \| "CANCELED" }` |
| POST   | `/comandas/:id/send`                   | operador | Envia itens pendentes → `{ jobIds, sent, unrouted }` |
| POST   | `/comandas/:id/items/:itemId/reprint`  | operador | Reimprime item → `{ jobIds }` |
| POST   | `/comandas/:id/checkout`               | operador | OPEN→PAYING + conta → `{ billJobId, warnings }` |
| POST   | `/comandas/:id/close`                  | operador | Fecha + libera mesa → `{ billJobId, warnings, comanda }` |
| DELETE | `/comandas/:id`                        | operador | Remove comanda aberta e sem itens |

**Status da comanda:** `OPEN → PAYING → CLOSED` · **item:** `PENDING → SENT → IN_PREP →
READY → SERVED` (ou `CANCELED`).

Regras relevantes:

- `quantity` 1–99; `note` até 200 chars; `aditionalIds` até 20.
- Item só pode ser editado/removido enquanto a comanda está `OPEN`.
- Remover item `PENDING` **apaga** o registro; item já enviado vira `CANCELED` — sai do
  total e do cupom da conta, mas permanece no histórico da comanda.
- `send` é idempotente por item: só envia status `PENDING`; sem pendentes → `400
  "Nenhum item pendente de envio"`.
- `unrouted: [{ itemId, product }]` lista itens **sem rota de impressão** (não são
  marcados como enviados).
- `checkout` é idempotente: em `PAYING` devolve `{ billJobId: null, warnings: ["…"] }`.
- `close` imprime a conta se ainda estava `OPEN`, grava `paymentMethod`, recalcula o total
  e devolve a mesa para `AVAILABLE`. Itens nunca enviados viram `warnings`.
- `POST /comandas` em mesa já ocupada → `409`.

`GET /comandas` → `{ "comandas": [ <resumo>, … ] }`. Resumo:

```json
{ "comanda": {
    "id": "…", "number": 1, "status": "OPEN", "openedAt": "…", "closedAt": null,
    "paymentMethod": null, "total": "13.50",
    "table": { "id": "…", "number": 1 },
    "waiter": { "id": "…", "username": "admin", "role": "ADMIN" } | null,
    "itemCount": 2, "pendingItems": 0 } }
```

Detalhe acrescenta `items[]`:

```json
{ "id": "…", "status": "SENT", "quantity": 2, "note": "sem cebola",
  "createdAt": "…", "unitPrice": "4.50", "total": "9.00", "canceled": false,
  "product": { "id": "…", "name": "Café Expresso", "categoryId": "…", "category": "Bebidas" },
  "aditionals": [ { "id": "…", "name": "Sem açúcar", "price": "0.00" } ] }
```

### 4.5 Impressoras

| Método | Rota                     | Acesso | Descrição |
| ------ | ------------------------ | ------ | --------- |
| GET    | `/printers`              | autenticado | Lista com `pendingJobs` e o vínculo (`agentId/agentName/baud/boundAt`) |
| POST   | `/printers`              | ADMIN | Cria a **fila** (nome/colunas/codepage). `address` é opcional — o printd preenche ao atrelar |
| POST   | `/printers/:id/attach`   | ADMIN/CHEF | Atrela a fila a um dispositivo do agente `{agentId, agentName, address, transport, baud?}`. 409 se já atrelada a outro agente |
| POST   | `/printers/:id/detach`   | autenticado (ADMIN libera qualquer fila; agente só a sua) | Limpa o vínculo; fila, rotas e histórico são preservados |
| PATCH  | `/printers/:id`          | ADMIN | Atualiza (inclusive `printsBill`) |
| DELETE | `/printers/:id`          | ADMIN | 409 se houver jobs `PENDING/PRINTING` |
| POST   | `/printers/:id/test`     | ADMIN/CHEF | Enfileira cupom de teste → `201 { jobId }` |
| GET    | `/printers/:id/queue`    | autenticado | `{ printer, jobs[] }` (`?status=&limit=`) |

```json
{ "name": "Cozinha", "address": "00:11:22:33:44:55", "transport": "BLUETOOTH",
  "columns": 32, "codepage": 19, "active": true, "printsBill": false }
```

- `transport ∈ BLUETOOTH | USB | NETWORK` (padrão BLUETOOTH), `columns` 16–64 (padrão 32),
  `codepage` 0–255 (padrão 19 = CP850). `baud` é gravado pelo attach quando o transporte é
  USB (padrão 9600).
- O daemon `printd` **não cria** impressora: ele chama `attach` com a identidade dele
  (`agentId` derivado de `/etc/machine-id` + hostname) e a API passa a ser a fonte de
  verdade de qual máquina drena a fila.
- `printsBill: true` define a impressora da **conta** — só uma pode ter `true` ao mesmo
  tempo (a anterior é desligada automaticamente).
- `pendingJobs` = jobs `PENDING` daquela impressora.

### 4.6 Rotas de impressão (alvo → impressora)

| Método | Rota                 | Acesso | Descrição |
| ------ | -------------------- | ------ | --------- |
| GET    | `/print-routes`      | autenticado | Lista com `printer` e `target` |
| POST   | `/print-routes`      | ADMIN | Cria rota → `201 { route }` |
| DELETE | `/print-routes/:id`  | ADMIN | |

```json
{ "printerId": "<uuid>", "productId": "<uuid>", "priority": 10 }
```

**XOR obrigatório:** informe exatamente um de `productId` OU `categoryId` — os dois (ou
nenhum) → `400` *"Informe exatamente um alvo: productId OU categoryId"*.
Rota duplicada (mesmo alvo + mesma impressora) → `409`.
`priority` 0–99 (maior primeiro, desempata entre impressoras).

`GET /print-routes` devolve `target.scope = "PRODUCT" | "CATEGORY"`.

### 4.7 Fila de impressão (para o agente `printd`)

| Método | Rota                          | Acesso | Descrição |
| ------ | ----------------------------- | ------ | --------- |
| GET    | `/print-jobs`                 | autenticado | `?printerId=&status=&limit=` (padrão 50) |
| POST   | `/print-jobs/claim`           | autenticado | Pega jobs: `PENDING → PRINTING` |
| POST   | `/print-jobs/:id/ack`         | autenticado | Resultado do envio físico |
| POST   | `/print-jobs/:id/retry`       | autenticado | `FAILED/CANCELED → PENDING` (zera tentativas) |
| POST   | `/print-jobs/:id/cancel`      | autenticado | Cancela job (não pode ser de um `DONE`) |

**Claim** — `{ "printerId": "<uuid>", "agentId": "…", "limit": 1..32 }` (padrão 8).
O `agentId` precisa bater com o vínculo salvo no attach: fila sem vínculo → `409 "não
está atrelada a nenhum agente"`; fila atrelada a outra máquina → `409 "atrelada a outro
agente"`:

```json
{ "jobs": [ {
  "id": "…", "kind": "ITEM", "status": "PRINTING", "attempts": 1,
  "claimedAt": "…", "comandaId": "…", "comandaItemId": "…",
  "columns": 32, "codepage": 19,
  "data": "G0BFAAkA…" } ] }
```

`data` são os **bytes ESC/POS prontos em base64** — o cliente só envia para a impressora.
A claim roda em transação com `FOR UPDATE SKIP LOCKED`: duas instâncias não levam o mesmo
job. Impressora inativa ou com vínculo de outro agente → `409`. Antes de devolver jobs,
jobs `PRINTING` com `claimedAt` antigo (> 5 min) voltam para `PENDING`.

**Ack** — `{ "success": true }` ou `{ "success": false, "error": "papel acabou" }`:

| Situação              | Resposta                                             |
| --------------------- | ---------------------------------------------------- |
| `success: true`       | `200 { id, status: "DONE", attempts }`               |
| `success: false` e `attempts < 3` | `200 { id, status: "PENDING", attempts }` (re-enfileira) |
| `success: false` e `attempts = 3` | `200 { id, status: "FAILED", attempts }`      |
| job já `DONE/CANCELED`| `200 { id, status, alreadyFinished: true }` (idempotente) |
| job em `PENDING`      | `409 "Job não está em impressão"` (ack atrasado)     |

**Retry** — `DONE` → `409 "Job já foi impresso"`; `PENDING/PRINTING` → `400 "Job já está
na fila"`; caso contrário `200 { id, status: "PENDING" }`.
**Cancel** — `DONE` → `409`; demais `200 { id, status: "CANCELED" }`.

---

## 5. Motor de impressão

### 5.1 Rotas de impressão (quem imprime o quê)

1. Rota por **produto** vence rota por **categoria**.
2. Várias impressoras para o mesmo alvo: ordena por `priority` (maior primeiro).
3. Um mesmo item pode ir para **mais de uma** impressora (ex.: cozinha + balcão).
4. Item sem nenhuma rota → fica `PENDING`, aparece em `unrouted` no `send` e **não** é
   marcado como enviado.
5. No `send`, os itens agrupam-se por impressora: **um cupom por impressora** com todos os
   itens daquela comanda destinados a ela (job `kind = ITEM`).
6. A conta vai só para a impressora com `printsBill = true` (job `kind = BILL`); se não
   houver nenhuma, `warnings` avisa e a conta não é enfileirada.

### 5.2 Ciclo do job

```
          claim (FOR UPDATE SKIP LOCKED)
PENDING ──────────────────────────────────► PRINTING
   ▲                                          │  │
   │  ack {success:false} (< 3 tentativas)   │  │ ack {success:true}
   └──────────────────────────────────────────┘  ▼
   ▲                              3ª falha ► FAILED ──retry──► PENDING
   │                                          │
   │  stale > 5 min (cliente caiu)            └──cancel──► CANCELED
   └──────────────────────────────────────────────────────────► (retry)
```

Constantes (`src/modules/printers/routes.ts`):

| Constante      | Valor  | Significado                                  |
| -------------- | ------ | -------------------------------------------- |
| `MAX_ATTEMPTS` | 3      | claims antes do job virar `FAILED`           |
| `STALE_MS`     | 5 min  | `PRINTING` abandonado volta para `PENDING`   |
| `CLAIM_DEFAULT`| 8      | jobs por claim sem `limit`                   |
| `QUEUE_DEFAULT`| 50     | limite padrão de listagens                   |

`attempts` é incrementado **no claim** — por isso o 3º ack negativo finaliza em `FAILED`.

### 5.3 Cupons (ESC/POS)

- Render **no backend** (`src/modules/printing/escpos.ts`): `ESC @` (reset), `ESC t <n>`
  (codepage do printer, padrão `19` = CP850), texto convertido com `iconv-lite`.
- Layout: cabeçalho do cupom, `kv` alinhado à esquerda/direita, separadores de 32 colunas,
  totais com 2 casas (`src/modules/printing/tickets.ts`).
- `kind ∈ ITEM | BILL | TEST`; o `payload` JSON fica no banco e os bytes são gerados no
  claim (assim mudar `columns`/`codepage` da impressora não exige reprocessar a fila).
- Tipos de cupom: `itemsTicket` (cozinha/bar), `billTicket` (conta) e `testTicket`.

### 5.4 Contrato do agente de impressão (`printd`)

```text
loop:
  1. POST /api/print-jobs/claim   { printerId, agentId } → jobs[] (data base64)
  2. para cada job: decodificar base64 → enviar via bluetooth (ESC/POS)
  3. POST /api/print-jobs/:id/ack { success, error? }
  4. se vazio: aguardar ~2s e repetir
```

Autenticação do cliente: login com o usuário `impressora` (ou qualquer papel — a fila usa
`requireAuth`, não exige ADMIN).

---

## 6. Modelo de dados (resumo)

`src/prisma/contract.prisma` é a fonte da verdade; `pnpm contract:emit` regenera
`contract.json`/`contract.d.ts`.

- **User** `username` único · **Table** `number` único · **Category** · **Product**
  (`categoryId`, `price Decimal`) · **Aditional**
- **Comanda** (`number` sequencial, `tableId`, `waiterId?`, `status`, `paymentMethod`,
  `total`) · **ComandaItem** (`productId`, `unitPrice` congelado no lançamento, `status`)
- **ComandaItemAditional** — junção explícita item↔adicional
- **Printer** (`name`, `address`, `transport`, `columns`, `codepage`, `active`,
  `printsBill`, vínculo com o agente: `agentId`, `agentName`, `baud`, `boundAt`) ·
  **PrintRoute** (`printerId` + XOR `productId`/`categoryId`, `priority`)
- **PrintJob** (`printerId`, `kind`, `payload Json`, `status`, `attempts`, `lastError`,
  `claimedAt`, `finishedAt`) — índices em `(printerId, status)` e `comandaId`

Enums: `TableStatus`, `ComandaStatus`, `PaymentMethod`, `ItemStatus`, `PrintJobKind`,
`PrintJobStatus`, `PrinterTransport`.

---

## 7. Fluxo completo (exemplo)

```bash
B=http://localhost:3001/api
TK=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token)
A="Authorization: Bearer $TK"

# 1. pegar mesa
T=$(curl -s $B/tables -H "$A" | jq -r '.tables[0].id')
CID=$(curl -s -X POST $B/tables/$T/take -H "$A" | jq -r .comanda.id)

# 2. lançar itens
P=$(curl -s $B/products -H "$A" | jq -r '.products[] | select(.name=="Café Expresso") | .id')
curl -s -X POST $B/comandas/$CID/items -H "$A" -H 'Content-Type: application/json' \
  -d "{\"productId\":\"$P\",\"quantity\":2,\"note\":\"sem açúcar\"}"

# 3. enviar para as rotas (item > categoria)
curl -s -X POST $B/comandas/$CID/send -H "$A" -H 'Content-Type: application/json' -d '{}'
# → { "jobIds": ["…"], "sent": 2, "unrouted": [] }

# 4. agente printd: claim + ack
PR=$(curl -s $B/printers -H "$A" | jq -r '.printers[] | select(.name=="Bar") | .id')
curl -s -X POST $B/print-jobs/claim -H "$A" -H 'Content-Type: application/json' \
  -d "{\"printerId\":\"$PR\",\"agentId\":\"<id-do-printd>\"}"
curl -s -X POST $B/print-jobs/<jobId>/ack -H "$A" -H 'Content-Type: application/json' \
  -d '{"success":true}'

# 5. conta e fechamento
curl -s -X POST $B/comandas/$CID/checkout -H "$A" -H 'Content-Type: application/json' -d '{}'
curl -s -X POST $B/comandas/$CID/close -H "$A" -H 'Content-Type: application/json' \
  -d '{"paymentMethod":"PIX"}'
# → { "billJobId": "…", "warnings": [], "comanda": { "status": "CLOSED", … } }
```

---

## 8. Clientes no monorepo

- `apps/web` — Next.js App Router (proxy `/api` → API em `:3001`): salão, comandas e administração.
- `apps/printd` — daemon Go que drena esta fila (`login → claim → ESC/POS/rede|RFCOMM → ack`);
  API local em `127.0.0.1` e pareamento simplificado ([`apps/printd/README.md`](../printd/README.md)).
- `apps/desktop` — Electron: só a UI do `printd` ([`apps/desktop/README.md`](../desktop/README.md)).

Tipos compartilhados com o front: `packages/shared` (`@leandrosys/shared`).
