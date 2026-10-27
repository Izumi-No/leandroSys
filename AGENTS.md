# AGENTS.md

Guia de trabalho para agentes de IA (e pessoas) neste repositório leandroSys. Leia antes de alterar qualquer coisa e siga o fluxo **sem exceção**. Todas as mudanças precisam ser revisáveis, testadas e documentadas.

---

## 1. Visão rápida do repositório

- **apps/api** – backend Node/TS usando Hono, Prisma 8, JWT, fila de impressão ESC/POS. Exposição HTTP via `src/app.ts`.
- **apps/printd** – daemon Go que gerencia a fila de impressão, faz `claim → transporte → ack` e expõe API local.
- **apps/web** – frontend React 19 + Vite, usa SWR e Tailwind v4, consome o OpenAPI.
- **apps/desktop** – cliente Electron que UI fina do daemon printd.
- **packages/shared** – tipos, enums e DTOs compartilhados entre os pacotes.
- **Docker** – `Dockerfile` (multistage) e `docker‑compose.yml` com serviços `api`, `postgres`, `eventstore`.
- **CI** – GitHub Actions (`.github/workflows/ci.yml`) executa lint, build e testes Vitest.
- **Banco** – PostgreSQL como fonte da verdade; migrations geridas por Prisma (`apps/api/migrations`).
- **Event Store** – EventStoreDB para Event Sourcing.
- **Contrato** – `openapi.yaml` descreve API pública.

---

## 2. Fluxo de branches (GitFlow)

| Branch       | Base                | Destino                | Padrão               | Uso                              |
| ------------ | ------------------- | ---------------------- | -------------------- | -------------------------------- |
| `main`       | —                   | —                      | protegida            | produção; recebe releases/hotfix |
| `develop`    | `main` (bootstrap)  | —                      | protegida            | integração contínua              |
| `feature/*` | `develop`           | `develop`              | `feature/<slug>`     | nova funcionalidade              |
| `bugfix/*`  | `develop`           | `develop`              | `bugfix/<slug>`      | correção não urgente             |
| `hotfix/*`  | `main`              | `main` + `develop`     | `hotfix/<slug>`      | correção urgente de produção     |
| `release/*` | `develop`           | `main` + tag + `develop`| `release/<versão>`   | preparação de release            |

**Regras**
- Nunca commitar direto em `main` ou `develop`.
- `<slug>` minúsculo, kebab‑case, sem acentos; opcional prefixo `ISSUE‑NUM`.
- Se `develop` ainda não existir: `git switch main && git pull && git switch -c develop main && git push -u origin develop`.
- Antes de abrir PR, rebase: `git fetch origin && git switch feature/<slug> && git rebase origin/develop` (ou `origin/main` para hotfix).
- Merge: **squash** para `feature/*`/`bugfix/*`; **merge commit (`--no-ff`)** para `release/*`/`hotfix/*`. Tag releases com `git tag -a vX.Y.Z -m "..."`.

---

## 3. Commits

Use [Conventional Commits](https://www.conventionalcommits.org/).
```
<tipo>(<escopo>): <resumo imperativo, ≤72 chars>

<corpo opcional explicando por que, não o que>

Refs #123
```
Tipos comuns: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`, `revert`.
Escopo exemplo: `api`, `printd`, `web`, `desktop`, `shared`, `ci`.

**Regras**
- Commits atômicos, uma intenção por commit.
- Não misture refactor com feature.
- Mudanças não relacionadas (ex.: renomear arquivos) em commit separado.
- Nunca incluir segredos ou tokens no diff.
- Só adicione `Co‑authored‑by` ou `Generated with …` quando explicitamente solicitado.

---

## 4. Testes (obrigatórios)

Qualquer mudança de comportamento requer **teste unitário** e, se houver I/O, **teste de integração**.

### Node/TS (Vitest)
```bash
pnpm exec vitest run            # unitários
pnpm exec vitest run --watch    # modo dev
```

### Go (printd)
```bash
go test ./...                    # unitários
# integração contra PostgreSQL real
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/printd_test \
  go test ./...                
```

Se precisar subir DB temporário:
```bash
docker run --name pg-test -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
createdb -h localhost -U postgres printd_test
```

**Cobertura mínima**
| Tipo de mudança | Teste obrigatório |
|------------------|-------------------|
| Regra de domínio / VO | unitário no módulo |
| Endpoint HTTP (api) | integração via supertest/axios |
| Worker / outbox (printd) | integração que verifica fila e entrega |
| Migration (Prisma) | teste que roda `pnpm db:update` em DB de teste |
| Permissões (RBAC) | unitário da matriz + integração 401/403 |
| Idempotência / concorrência | teste de replay ou chamadas simultâneas |

Nunca usar `t.Skip`/`test.skip` para ocultar falha.
Rode a suíte completa antes de abrir PR.

---

## 4.1. Documentação (mesmo commit/PR)

- `openapi.yaml` – atualizar sempre que rota, request ou response mudar. Valide com `npx @redocly/cli lint openapi.yaml`.
- `README.md` – listagem de rotas públicas, comandos de setup Docker, notas de design.
- `apps/api/README.md`, `apps/printd/README.md`, `apps/web/README.md`, `apps/desktop/README.md` – detalhes específicos de cada pacote.
- `packages/shared/README.md` – definição de DTOs, enums e contratos compartilhados.

---

## 5. Push e Pull Request
```bash
# 1. criar branch
git switch -c feature/<slug> develop

# 2. commits convencionais
git add -A && git commit

# 3. push
git push -u origin feature/<slug>

# 4. abrir PR (GitHub CLI ou navegador)
# CLI exemplo
gh pr create --base develop --title "feat(<escopo>): <resumo>" --body-file .git/PR_BODY.md
```
Se `gh` indisponível, use a URL de comparação mostrada pelo `git push`.
Base PR: `develop` para `feature/*`/`bugfix/*`; `main` para `hotfix/*`/`release/*`.

### Corpo do PR (markdown)
```markdown
## Contexto
<por que a mudança existe, link do issue>

## O que mudou
- <item 1>
- <item 2>

## Como testar
- `pnpm exec vitest run`
- `go test ./...`
- (passos manuais, se houver)

## Checklist
- [ ] branch criada a partir da base correta (GitFlow)
- [ ] commits atômicos e Conventional Commits
- [ ] testes unitários e de integração verdes
- [ ] `openapi.yaml` / `README.md` / specs atualizados
- [ ] sem segredos no diff
- [ ] migration listada no README (se houver)

Closes #<issue>
```

---

## 6. Definition of Done
- Branch no padrão GitFlow, criada a partir de `develop` (ou `main` para hotfix).
- Commits atômicos em Conventional Commits.
- Testes unitários **e** de integração cobrem todas as mudanças.
- Suíte completa verde (`pnpm exec vitest` + `go test`).
- `openapi.yaml` atualizado para alterações de contrato.
- `README.md` e documentos de pacote (`apps/*/README.md`, `packages/shared/README.md`) atualizados.
- Nenhum segredo, token ou credencial no diff.
- PR aberto com base correta, corpo preenchido e issue linkada.

---

## 7. Guardrails específicos deste repositório
- **Node**: use ESLint/Prettier configurados; evite dependências novas sem necessidade.
- **Go**: siga `go.mod`; não use `cgo` nem bibliotecas externas pesadas.
- **Sem ponto flutuante**: valores monetários armazenados como inteiros (cents) no DB.
- **RBAC**: JWT contém `tenant_id` e `role`; nunca confiar em payload do cliente.
- **Event Sourcing**: todos os eventos gravados em EventStoreDB; replays devem ser idempotentes.
- **Migrations**: Prisma migrations compatíveis com blue‑green (não quebram versão anterior).
- **Printd**: daemon nunca acessa hardware diretamente; comunicação via outbox/queue para gateway externo.

---

## 8. Comandos úteis
```bash
# Instalar workspace
pnpm install

# Desenvolvimento rápido (API + web)
pnpm dev

# Desenvolvimento completo (API + web + desktop)
pnpm dev:all

# Build de todos os pacotes
pnpm build

# Typecheck (tsc --noEmit)
pnpm typecheck

# Banco
pnpm db:update          # aplica migrations Prisma
pnpm seed               # popula dados iniciais

# Emitir contrato OpenAPI
pnpm contract:emit

# Docker compose (dev)
docker compose up -d

# Lint OpenAPI
npx @redocly/cli lint openapi.yaml
```