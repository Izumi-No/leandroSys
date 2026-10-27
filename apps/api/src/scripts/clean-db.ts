/**
 * Script de limpeza do banco de dados.
 * Mantém apenas a(s) tabela(s) de usuários (e a de contas, caso exista).
 * Utilizado em desenvolvimento e CI para garantir um estado limpo antes dos testes.
 */
import { db } from '../prisma/db';

async function clean() {
  // Remove todas as tabelas públicas exceto User/Account (dependendo do modelo de auth).
  await db.$executeRawUnsafe(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename NOT IN ('User', 'Account')
      ) LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', r.tablename);
      END LOOP;
    END $$;
  `);
  console.log('🧹 DB limpo – apenas usuários permanecem.');
  await db.$disconnect();
}

clean().catch((e) => {
  console.error('Erro ao limpar DB:', e);
  process.exit(1);
});