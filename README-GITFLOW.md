# GitFlow e boas práticas

## Ramificações (branches)
- **`main`** – branch protegida, contém o código em produção.
- **`develop`** – branch de integração contínua. Todas as funcionalidades são mescladas aqui antes de um release.
- **`feature/<slug>`** – criada a partir de `develop`; contém uma nova funcionalidade. Ao terminar, faça **squash merge** para `develop`.
- **`bugfix/<slug>`** – correções não urgentes a partir de `develop`; também squash merge.
- **`hotfix/<slug>`** – correções urgentes a partir de `main`; merge **--no‑ff** para `main` e `develop`.
- **`release/<versão>`** – preparação de release a partir de `develop`; merge commit (não squash) para `main` e `develop`.

## Convenções de commit (Conventional Commits)
```
<tipo>(<escopo>): <resumo imperativo>

<corpo opcional>

Refs #<issue>
```
- `feat` – nova funcionalidade
- `fix` – correção de bug
- `docs` – documentação
- `test` – testes
- `refactor` – mudança interna sem alterar comportamento
- `chore` – manutenção/código de build
- `ci` – alterações de CI/CD
- `perf` – melhorias de performance

## Fluxo de trabalho típico
1. **Criar branch**
   ```bash
   git switch -c feature/minha-nova-funcionalidade develop
   ```
2. **Desenvolver** – escreva testes, mantenha o código lint‑free (`pnpm lint`).
3. **Commit** usando Conventional Commits.
4. **Push** e abra PR:
   ```bash
   git push -u origin feature/minha-nova-funcionalidade
   gh pr create --base develop --title "feat(api): descrição" --body "..."
   ```
5. **Revisar** – CI roda lint, testes e `pnpm typecheck`. Quando tudo verde, faça **squash merge**.
6. **Release** – crie branch `release/vX.Y.Z` a partir de `develop`, atualize changelog, tag e merge.

## Lint & format
- Use o **Biome** (já configurado). Comandos:
  - `pnpm lint` – roda o check.
  - `pnpm format` – formata o código.
- O CI inclui `pnpm lint && pnpm test && pnpm typecheck`.

## Integração com CI (GitHub Actions)
O workflow já existente executa lint, teste e build. Não altere sem atualizar o arquivo `.github/workflows/ci.yml`.

---
Este documento deve estar sempre atualizado. Qualquer mudança no fluxo GitFlow ou nas convenções deve ser refletida aqui.
