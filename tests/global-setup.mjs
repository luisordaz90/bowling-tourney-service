// tests/global-setup.mjs
// Runs once in the main process before any test workers start.
// Recreates the test database and applies all migrations.
import { createRequire } from 'module';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: join(__dirname, '../.env.local') });

const DB_USER = process.env.DB_USER || 'postgres';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PASSWORD = process.env.DB_PASSWORD || 'example';
const DB_PORT = parseInt(process.env.DB_PORT || '5432');
const TEST_DB = 'bowling-tourney-test';

export async function setup() {
  // Connect to default postgres DB to (re)create test DB
  const adminPool = new Pool({
    user: DB_USER,
    host: DB_HOST,
    database: 'postgres',
    password: DB_PASSWORD,
    port: DB_PORT,
  });

  // Terminate any existing connections to the test DB before dropping
  await adminPool.query(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = $1 AND pid <> pg_backend_pid()
  `, [TEST_DB]);

  await adminPool.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  await adminPool.query(`CREATE DATABASE "${TEST_DB}"`);
  await adminPool.end();

  // Run migrations on the fresh test DB
  const testPool = new Pool({
    user: DB_USER,
    host: DB_HOST,
    database: TEST_DB,
    password: DB_PASSWORD,
    port: DB_PORT,
  });

  const migrationsDir = join(__dirname, '../db/migrations');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await testPool.query(sql);
  }

  await testPool.end();
}

export async function teardown() {
  // Leave the test DB in place for inspection after failures
}
