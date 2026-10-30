# leandroSys

Sistema de comandas e mesas com filas de impressão por impressora (ESC/POS), rotas de
impressão por categoria ou por item, e painel administrativo.

Monorepo gerenciado com **pnpm workspaces**.

## Estrutura

```
leandroSys/
├── apps/
│   ├── api/        # API Hono + Kysely/Neon (comandas, mesas, fila de impressão)
│   ├── web/        # App Next.js + React (salão, comandas, administrativo)
│   ├── printd/     # Daemon Go: dono da fila (claim → transporte → ack) + API local
│   └── desktop/    # Electron: só UI — cliente fino do printd
├── packages/
│   └── shared/     # Tipos, enums e constantes compartilhados
├── pnpm-workspace.yaml
└── tsconfig.base.json   # compilerOptions comuns
```

| Pacote                | Nome                  | O que é |
| --------------------- | --------------------- | ------- |
| `apps/api`            | `@leandrosys/api`     | Rotas Hono e domínio: Kysely/Neon, JWT, fila de jobs ESC/POS |
| `apps/web`            | `@leandrosys/web`     | Next.js App Router + React 19; API same-origin em `/api/*` |
| `apps/printd`         | `@leandrosys/printd`  | **Daemon em Go**: dono da fila — pareia as impressoras da casa (Bluetooth/rede) e drena todas as filas em paralelo; API local em `127.0.0.1` |
| `apps/desktop`        | `@leandrosys/desktop` | Electron 45: **só UI do printd** — configuração (1x), pareamento simplificado, estado das impressoras e log |
| `packages/shared`     | `@leandrosys/shared`  | DTOs e enums espelhados da API (fonte TS direta, sem build) |

## Comandos (na raiz)

```bash
pnpm install          # instala todos os pacotes e linka o workspace

pnpm dev              # Next.js (3000), incluindo as rotas /api/*
pnpm dev:desktop      # build + Electron
pnpm dev:all          # todos os serviços e aplicações em paralelo
pnpm build            # build de produção do Next.js
pnpm build:all        # build de todos os pacotes (inclui o daemon Go)
pnpm typecheck        # tsc --noEmit em todos os pacotes

pnpm seed             # dados iniciais (veja tabela abaixo)
pnpm db:update        # aplica o schema do Prisma
pnpm contract:emit    # regenera contract.json / contract.d.ts
```

Por pacote: `pnpm --filter ./apps/api dev` inicia o servidor Hono standalone em `:3001`; `pnpm --filter ./apps/web build` compila o Next.js. No fluxo principal, o Next.js monta a API Hono nas rotas `/api/*`, sem `API_ORIGIN` ou serviço HTTP separado.

## Primeira execução

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # necessário para seed e Hono standalone
docker start leandrosys-db               # Postgres dev (container de trabalho)
pnpm db:update
pnpm seed
pnpm dev
```

Usuários do seed: `admin/admin123`, `garcom/garcom123`, `caixa/caixa123`,
`cozinha/cozinha123`, `impressora/impressora123` (usado pelo daemon `printd`).

## Documentação

- [`docs/fluxo.md`](docs/fluxo.md) — **fluxo de ponta a ponta**: mesa → comanda → itens →
  envio → rotas → fila → `claim` → `ack` → conta → fechamento, com garantias, limitações e
  casos-limite.
- [`apps/api/README.md`](apps/api/README.md) — API completa: endpoints, autenticação,
  papéis, contrato de erros e motor de impressão.
- [`apps/printd/README.md`](apps/printd/README.md) — **daemon de impressão** (Go): dono
  da fila (`claim` → transporte → `ack`), API local, pareamento simplificado, transportes
  (rede e Bluetooth por socket RFCOMM nativo) e o smoke E2E.
- [`apps/desktop/README.md`](apps/desktop/README.md) — **UI da impressão** (Electron):
  cliente fino do `printd` — sobe o daemon se preciso, configuração única e pareamento
  com um campo.
- `apps/api/prisma-8.md` — notas sobre Prisma 8 (contract, `db update`, codecs).

Os diagramas têm fonte D2 em [`docs/diagrams/`](docs/diagrams); regenere os SVG com
`pnpm docs:build` (requer o [D2](https://d2lang.com) instalado).

## Estado

- **Feito:** API completa (contract + endpoints + fila), o front do `apps/web` — login,
  salão (ocupar/reservar/transferir/liberar), comandas (lançar, enviar, conta, fechar) e
  administração (mesas, cardápio, impressoras, rotas, fila e usuários) — e a impressão
  de ponta a ponta: o **daemon `apps/printd`** (Go) drena todas as filas em paralelo
  (1 goroutine por impressora, dedup e backoff), pareia com **um campo só** e fala com
  as impressoras por rede (TCP) ou **Bluetooth RFCOMM via socket nativo do kernel** (sem
  módulo nativo); o `apps/desktop` é a UI fina que conversa com ele em `127.0.0.1`.
  Fan-out comprovado por `pnpm --filter @leandrosys/printd smoke` (um pedido → duas vias
  nas duas cozinhas).
- **Próximo:** transporte USB, retry/cancel na UI para o operador e testes com hardware
  real (Bluetooth/rede).

### Frontend (`apps/web`)

- Next.js App Router + React 19 hospeda o sistema; as telas existentes mantêm React Router durante a migração gradual. Tailwind v4 e tokens em `src/styles.css`; componentes shadcn/ui em `src/components/ui`.
- O Route Handler `/api/[...path]` executa a aplicação Hono dentro do Next.js, preservando autenticação, contratos e lógica de domínio. As rotas são same-origin em desenvolvimento e produção; não é necessário configurar `API_ORIGIN`.
- Dados via SWR; o cliente em `src/lib/api.ts` mantém o contrato de erros `{ error, code, details }` e o Bearer do JWT.
- Rotas: `/login`, `/` (salão), `/comandas`, `/comandas/:id` e `/admin/*` (ADMIN).
- Comandos: `pnpm --filter ./apps/web dev`, `build`, `typecheck`.
