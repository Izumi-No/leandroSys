import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

export function createDatabase(connectionString = process.env['DATABASE_URL']) {
  if (!connectionString) throw new Error('DATABASE_URL não configurada');

  const client = new Pool({ connectionString, max: 1 });
  const db = drizzle({ client, schema });

  return {
    db,
    close: () => client.end(),
  };
}

export type AppDb = ReturnType<typeof createDatabase>['db'];
export type DbTransaction = Parameters<Parameters<AppDb['transaction']>[0]>[0];
export type DbLike = AppDb | DbTransaction;
