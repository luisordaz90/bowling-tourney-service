// db/run-migrations.js
// Runs all .sql files inside db/migrations/ in alphabetical order.
// Skips files that have already been executed (tracked in the migrations table).
// Each file is wrapped in a transaction; a failure rolls back and exits.

require('dotenv').config({ path: './.env.local' });

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

// The migration runner always connects with admin (superuser) credentials so
// it can execute DDL and bypass RLS. It does NOT use config/database.js, which
// connects as the low-privilege bowling_app role.
const pool = new Pool({
  user:     process.env.DB_USER     || 'postgres',
  host:     process.env.DB_HOST     || 'localhost',
  database: process.env.DB_NAME     || 'bowling-tournament',
  password: process.env.DB_PASSWORD || 'example',
  port:     parseInt(process.env.DB_PORT || '5432'),
});

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations() {
  const client = await pool.connect();

  try {
    console.log('Starting database migrations…');

    // Ensure the tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id          SERIAL PRIMARY KEY,
        filename    VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found.');
      return;
    }

    for (const file of files) {
      const already = await client.query(
        'SELECT id FROM migrations WHERE filename = $1',
        [file]
      );

      if (already.rows.length > 0) {
        console.log(`  ✓  ${file} (already applied)`);
        continue;
      }

      console.log(`  →  Running ${file}…`);

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✓  ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗  ${file} failed:\n`, err.message);
        throw err;
      }
    }

    console.log('\nAll migrations applied successfully.');
  } catch (err) {
    console.error('\nMigration run aborted:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };
