// config/database.js
//
// Two credential tiers:
//   DB_APP_USER / DB_APP_PASSWORD  — low-privilege bowling_app role (used by the server)
//   DB_USER     / DB_PASSWORD      — superuser fallback (used by run-migrations.js directly)
//
// The app pool connects as bowling_app and is subject to RLS policies.
// The migration runner creates its own pool using the admin credentials so that
// it bypasses RLS and can execute DDL freely.

const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

// Stores the team-scoped DB client for the duration of a request.
// Set by requireTeamContext middleware; read by withTransaction.
const requestContext = new AsyncLocalStorage();

const dbConfig = {
  user:     process.env.DB_APP_USER      || process.env.DB_USER     || 'postgres',
  host:     process.env.DB_HOST          || 'localhost',
  database: process.env.DB_NAME          || 'bowling-tournament',
  password: process.env.DB_APP_PASSWORD  || process.env.DB_PASSWORD || 'password',
  port:     process.env.DB_PORT          || 5432,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

const pool = new Pool(dbConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Basic query helper — no team context (use for public/admin reads).
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    console.error('Database query error:', { text, params, error: error.message });
    throw error;
  }
};

const getClient = async () => pool.connect();

// Transaction helper.
//
// If requireTeamContext middleware is active for this request it will have
// stored a team-scoped client in requestContext. That client already has an
// open transaction with SET LOCAL app.current_team_id, so we reuse it and
// skip BEGIN/COMMIT/ROLLBACK — the middleware owns the lifecycle.
//
// Without middleware context a fresh client + transaction is created here.
const withTransaction = async (callback) => {
  const contextClient = requestContext.getStore()?.client;
  if (contextClient) {
    return callback(contextClient);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Transaction with RLS team context.
//
// Sets the transaction-scoped variable app.current_team_id before running the
// callback. PostgreSQL RLS policies on team-owned tables read this variable via:
//   current_setting('app.current_team_id', true)
//
// SET LOCAL automatically resets on COMMIT/ROLLBACK, so the value never leaks
// across requests even when connections are reused from the pool.
//
// Usage:
//   await withTeamContext(req.teamId, async (client) => {
//     await client.query('INSERT INTO team_players ...', [...]);
//   });
const withTeamContext = async (teamId, callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_team_id = $1', [teamId]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const closePool = async () => {
  try {
    await pool.end();
    console.log('Database pool closed');
  } catch (error) {
    console.error('Error closing database pool:', error);
  }
};

module.exports = {
  query,
  getClient,
  withTransaction,
  withTeamContext,
  requestContext,
  pool,
  closePool,
};
