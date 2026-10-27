const { neon } = require('neon-serverless');
const { readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL required');

const sql = neon(url);
const ddl = readFileSync(join(dirname(__filename), '..', 'prisma', 'schema.sql'), 'utf8');

(async () => {
  const stmts = ddl.split(';').map(s => s.trim()).filter(s => s.length > 0);
  let ok = 0;
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    try {
      const r = await sql(s);
      ok++;
      process.stdout.write(`[${i + 1}/${stmts.length}] OK: ${s.slice(0, 80)}\n`);
    } catch (e) {
      process.stdout.write(`[${i + 1}/${stmts.length}] ERR: ${e.message.slice(0, 120)}\n  SQL: ${s.slice(0, 120)}\n`);
    }
  }
  console.log(`\nApplied ${ok}/${stmts.length} statements.`);
})();