// middleware/requireTeamContext.js
//
// Validates that the authenticated player is an active member of the team
// being targeted by the request, then opens a transaction on a dedicated DB
// connection with SET LOCAL app.current_team_id so that every query within
// that connection is subject to RLS team-scoped policies.
//
// The client is attached to req.dbClient. Controllers pass it to withTransaction()
// as the second argument so they reuse the same connection (and therefore the
// same SET LOCAL context) rather than acquiring a fresh one from the pool.
//
// Transaction lifecycle:
//   - COMMIT  on res 'finish' (response fully sent)
//   - ROLLBACK on res 'close' (client disconnected before response finished)
//
// Must run after jwtCheck + requirePlayer so that req.player is populated.
//
// teamId resolution order:
//   1. req.body.teamId       — score submissions, team score calculation
//   2. req.params.teamId     — nested tournament/team routes
//   3. req.params.id         — direct team routes (PUT /teams/:id)
//
// Requests with no resolvable teamId are passed through unchanged.

const { query, pool, requestContext } = require('../config/database');
const logger = require('../config/logger');

const requireTeamContext = async (req, res, next) => {
  const teamId = req.body?.teamId ?? req.params?.teamId ?? req.params?.id ?? null;

  if (!teamId) return next();

  const playerId = req.player?.id;
  if (!playerId) {
    return res.status(401).json({ error: 'Player identity required' });
  }

  try {
    // Validate membership — fast indexed lookup, no transaction needed
    const memberResult = await query(
      `SELECT 1
       FROM   team_players
       WHERE  player_id = $1
         AND  team_id   = $2
         AND  is_active = true
       LIMIT  1`,
      [playerId, teamId]
    );

    if (memberResult.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    // Acquire a dedicated client and open a team-scoped transaction
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      // SET LOCAL resets automatically on COMMIT/ROLLBACK — never leaks across requests
      await client.query('SET LOCAL app.current_team_id = $1', [teamId]);
    } catch (err) {
      client.release();
      throw err;
    }

    req.teamId = teamId;

    // Ensure cleanup runs exactly once regardless of which event fires first
    let cleaned = false;
    const cleanup = async (commit) => {
      if (cleaned) return;
      cleaned = true;
      try {
        await client.query(commit ? 'COMMIT' : 'ROLLBACK');
      } catch (e) {
        logger.error('requireTeamContext: cleanup error', e);
      } finally {
        client.release();
      }
    };

    res.on('finish', () => cleanup(true));
    res.on('close',  () => cleanup(false));

    // Run the rest of the request inside the async context so that
    // withTransaction automatically picks up this client.
    requestContext.run({ client }, next);
  } catch (error) {
    logger.error('requireTeamContext: failed to establish team context', error);
    res.status(500).json({ error: 'Failed to verify team membership' });
  }
};

module.exports = requireTeamContext;
