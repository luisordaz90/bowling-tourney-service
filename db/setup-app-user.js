// db/setup-app-user.js
// One-time script: creates the low-privilege bowling_app database role and
// grants it the minimum permissions the application needs.
//
// Run as: node db/setup-app-user.js
// Requires DB_USER / DB_PASSWORD to be a superuser (postgres).
// Reads DB_APP_USER / DB_APP_PASSWORD from .env.local for the new role.
//
// Safe to re-run: role creation and grants are idempotent.

require('dotenv').config({ path: './.env.local' });

const { Pool } = require('pg');

const adminPool = new Pool({
  user:     process.env.DB_USER     || 'postgres',
  host:     process.env.DB_HOST     || 'localhost',
  database: process.env.DB_NAME     || 'bowling-tourney',
  password: process.env.DB_PASSWORD || 'example',
  port:     parseInt(process.env.DB_PORT || '5432'),
});

const APP_USER = process.env.DB_APP_USER     || 'bowling_app';
const APP_PASS = process.env.DB_APP_PASSWORD;
const DB_NAME  = process.env.DB_NAME         || 'bowling-tourney';

if (!APP_PASS) {
  console.error('DB_APP_PASSWORD is not set in .env.local — aborting.');
  process.exit(1);
}

async function setup() {
  const client = await adminPool.connect();
  try {
    console.log(`Setting up app user: ${APP_USER}`);

    // ── 1. Create role (no-op if it already exists) ───────────────────────────
    // CREATE ROLE cannot run inside a transaction, so we check pg_roles first.
    const existing = await client.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [APP_USER]
    );

    if (existing.rows.length === 0) {
      // Identifiers can't be parameterised — APP_USER is from our own env, not user input.
      await client.query(`CREATE ROLE ${APP_USER} WITH LOGIN PASSWORD '${APP_PASS}'`);
      console.log(`  ✓  Role '${APP_USER}' created`);
    } else {
      // Update password in case it changed
      await client.query(`ALTER ROLE ${APP_USER} WITH PASSWORD '${APP_PASS}'`);
      console.log(`  ✓  Role '${APP_USER}' already exists — password updated`);
    }

    // ── 2. Database-level access ──────────────────────────────────────────────
    await client.query(`GRANT CONNECT ON DATABASE "${DB_NAME}" TO ${APP_USER}`);
    console.log(`  ✓  GRANT CONNECT ON DATABASE "${DB_NAME}"`);

    // ── 3. Schema-level access ────────────────────────────────────────────────
    await client.query(`GRANT USAGE ON SCHEMA public TO ${APP_USER}`);
    console.log(`  ✓  GRANT USAGE ON SCHEMA public`);

    // ── 4. Table-level DML ────────────────────────────────────────────────────
    // Grant on all current tables, then set default privileges for future ones.
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_USER}`
    );
    // Revoke access to the internal migrations tracking table — the app has no
    // business reading or writing migration history.
    await client.query(`REVOKE ALL ON migrations FROM ${APP_USER}`);
    console.log(`  ✓  GRANT DML ON ALL TABLES (migrations excluded)`);

    // Default privileges ensure future migration-created tables are also covered.
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_USER}`
    );
    console.log(`  ✓  ALTER DEFAULT PRIVILEGES set for future tables`);

    // ── 5. Function execute ───────────────────────────────────────────────────
    await client.query(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${APP_USER}`
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT EXECUTE ON FUNCTIONS TO ${APP_USER}`
    );
    console.log(`  ✓  GRANT EXECUTE ON ALL FUNCTIONS`);

    console.log(`\nDone. Add these to .env.local if not already present:`);
    console.log(`  DB_APP_USER=${APP_USER}`);
    console.log(`  DB_APP_PASSWORD=<your value>`);

  } finally {
    client.release();
    await adminPool.end();
  }
}

setup().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
