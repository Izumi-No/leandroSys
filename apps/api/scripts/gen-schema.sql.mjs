import { neon } from 'neon-serverless';
import { writeFileSync } from 'node:fs';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL required');

const sql = neon(url);

const tables = await sql`
  SELECT t.tablename
  FROM pg_tables t
  WHERE t.schemaname = 'public'
  ORDER BY t.tablename
`;

let out = '';
for (const { tablename } of tables) {
  const cols = await sql`
    SELECT c.column_name, c.data_type, c.is_nullable, c.column_default
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = ${tablename}
    ORDER BY c.ordinal_position
  `;

  const colDefs = cols.map(c => {
    let d = `"${c.column_name}" ${c.data_type}`;
    if (c.column_default) d += ` DEFAULT ${c.column_default}`;
    if (c.is_nullable === 'NO') d += ' NOT NULL';
    return d;
  }).join(',\n  ');

  out += `CREATE TABLE "${tablename}" (\n  ${colDefs}\n);\n\n`;
}

// foreign keys
const fks = await sql`
  SELECT
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS ref_table,
    ccu.column_name AS ref_column
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
`;

for (const fk of fks) {
  out += `ALTER TABLE "${fk.table_name}" ADD CONSTRAINT "${fk.constraint_name}" FOREIGN KEY ("${fk.column_name}") REFERENCES "${fk.ref_table}" ("${fk.ref_column}");\n`;
}

writeFileSync('apps/api/prisma/schema.sql', out);
console.log('Schema written to apps/api/prisma/schema.sql');
console.log(out);