/**
 * Applies schema.sql to the configured database. Idempotent — every statement
 * uses IF NOT EXISTS. Run with: npm run migrate
 */
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import env from '../env';

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  // Connect without a database selected — schema.sql creates + selects it.
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });

  console.log(`Applying schema to ${env.db.host}:${env.db.port} ...`);
  await conn.query(sql);
  await conn.end();
  console.log('Schema applied successfully.');
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
