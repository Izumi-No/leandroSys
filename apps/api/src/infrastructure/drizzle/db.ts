import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from './index';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

import { orm } from './ormAdapter';
export const db = drizzle(pool, { schema });
export { orm };

