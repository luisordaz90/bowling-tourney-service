// tests/setup.js
// Runs in each test worker before test files are loaded.
// Sets env vars BEFORE dotenv.config() in server.js can override them.
process.env.DB_NAME = 'bowling-tourney-test';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.NODE_ENV = 'test';
// Silence pino logs during tests
process.env.LOG_LEVEL = 'silent';

// Tests connect as the superuser (postgres) so that:
//   1. bowling-tourney-test can be accessed without granting bowling_app to it.
//   2. RLS policies are bypassed — we test API behaviour, not DB-level fencing.
// RLS enforcement is covered by the migration comments and manual verification.
process.env.DB_APP_USER     = process.env.DB_USER     || 'postgres';
process.env.DB_APP_PASSWORD = process.env.DB_PASSWORD || 'example';
