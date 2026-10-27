# justfile — comandos para o monorepo leandroSys
# Uso: just <alvo>

# ---------------------------------------------------------------------------
# Serviços
# ---------------------------------------------------------------------------

# Sube a API (porta 3000) em background.
start-api:
    nohup pnpm --filter @leandrosys/api start > /tmp/opencode/api.log 2>&1 &
    sleep 5
    curl -s http://localhost:3000/api/health

# Sube o daemon printd (porta 7411) em background.
start-daemon:
    pkill -x printd 2>/dev/null || true
    sleep 1
    nohup ./apps/printd/bin/printd > /tmp/opencode/printd.log 2>&1 &
    sleep 2
    cat /tmp/opencode/printd.log | tail -3

# Inicia API + daemon juntos.
start: start-api start-daemon

# Para API e daemon.
stop:
    pkill -f 'tsx' 2>/dev/null || true
    pkill -f 'node.*index' 2>/dev/null || true
    pkill -f '[p]rintd' 2>/dev/null || true
    sleep 2
    echo "serviços parados"

# ---------------------------------------------------------------------------
# Banco de dados
# ---------------------------------------------------------------------------

# Limpa todas as tabelas exceto User/Account.
db-clean:
    docker exec leandrosys-db psql -U leandrosys -d leandrosys -c "DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('User','Account')) LOOP EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', r.tablename); END LOOP; END $$;"

# Atualiza o schema (migração).
db-migrate:
    pnpm --filter @leandrosys/api db:update

# Recria o estado limpo: limpa + migra + seed.
db-reset: db-clean db-migrate seed

# Popula o banco com dados iniciais.
seed:
    pnpm --filter @leandrosys/api seed

# ---------------------------------------------------------------------------
# Testes
# ---------------------------------------------------------------------------

# Testes unitários (Go + TS).
test-unit:
    cd apps/printd && go test ./... -v
    pnpm -r typecheck

# Testes de integração (Docker).
test-int:
    cd apps/printd && go test ./... -run Integration -count=1

# Roda todos os testes.
test-all: test-unit test-int

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

# Compila todo o monorepo.
build:
    pnpm -r build

# ---------------------------------------------------------------------------
# Smoke (E2E)
# ---------------------------------------------------------------------------

# Roda o smoke test de ponta a ponta.
smoke:
    cd apps/printd && go run ./cmd/smoke

# ---------------------------------------------------------------------------
# Desktop
# ---------------------------------------------------------------------------

# Inicia o Electron.
desktop:
    cd apps/desktop && pnpm dev

# ---------------------------------------------------------------------------
# Diagnóstico rápido
# ---------------------------------------------------------------------------

# Mostra o estado atual dos serviços e do banco.
status:
    echo "=== API ==="
    curl -s http://localhost:3000/api/health || echo "offline"
    echo "=== Daemon ==="
    curl -s -H 'X-Printd-Token: 56c03dbde4594f142c9346979ee3d6db' http://localhost:7411/estado | head -c 200 || echo "offline"
    echo "=== Portas ==="
    ss -ltn | grep -E ':3000|:7411' || echo "nenhuma"