# Makefile do monorepo leandroSys

.PHONY: build test db:clean db:migrate

build:
	@pnpm -r build






test:int:
	@echo "▶️  Testes de Integração (Docker)…"
	@cd apps/printd && go test ./... -run Integration -count=1



db:clean:
	@echo "🧹 Limpando DB (mantendo usuários)…"
	@pnpm --filter @leandrosys/api ts-node src/scripts/clean-db.ts

db:migrate:
	@pnpm --filter @leandrosys/api db:update