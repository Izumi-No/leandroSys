import 'dotenv/config';
import { db } from '../../infrastructure/drizzle/db';
import { schema } from '../../infrastructure/drizzle/schema';
import { eq, and, neq } from 'drizzle-orm';

// Delete all categories (example script)
const res = await db.delete(schema.categories).run();
console.log('deleted', res);