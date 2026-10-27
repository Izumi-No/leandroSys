const { neon } = require('neon-serverless');

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL required');

const sql = neon(url);

(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  console.log('Schema cleaned.');
})();