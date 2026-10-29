/**
 * Script de limpeza do banco de produção.
 * Mantém apenas a tabela de usuários.
 */
import { db } from '../infrastructure/drizzle/db';

async function clean() {
  // Lista explícita de modelos a limpar (exceto User)
  const models = [
    'PrintJob',
    'PrintRoute',
    'ComandaItemAditional',
    'ComandaItem',
    'Aditional',
    'Comanda',
    'Product',
    'Table',
    'Printer',
    'Category',
  ] as const;
  for (const name of models) {
    const table = (schema as any)[name];
    if (table) await db.delete(table).run();
  }
}

clean()
  .then(() => console.log('🧹 DB limpo – apenas usuários permanecem.'))
  .catch((e) => console.error('Erro ao limpar DB:', e))
  .finally(() => db.$disconnect?.());