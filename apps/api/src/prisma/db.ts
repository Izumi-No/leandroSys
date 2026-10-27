import { Kysely } from 'kysely';
import { NeonHttpDialect } from './neon-http-driver';
import type { Database } from './types';

const url = new URL(process.env['DATABASE_URL']!);
export const db = new Kysely<Database>({
  dialect: new NeonHttpDialect({
    host: url.hostname,
    database: url.pathname.replace(/^\//, ''),
    user: url.username,
    password: url.password,
  }),
});

export default db;