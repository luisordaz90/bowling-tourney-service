// middleware/requireTeamContext.js
//
// Validates that the authenticated player is an active member of the team
// being targeted by the request, then stores the teamId in requestContext
// so that withTransaction() applies SET LOCAL app.current_team_id for RLS.
//
// Must run after resolveRoles so that req.player is populated.
//
// teamId resolution order:
//   1. req.body.teamId       — score submissions, team score calculation
//   2. req.params.teamId     — nested tournament/team routes
//   3. req.params.id         — direct team routes (PUT /teams/:id)
//
// Requests with no resolvable teamId are passed through unchanged.

const { query, requestContext } = require('../config/database');
const logger = require('../config/logger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const requireTeamContext = async (req, res, next) => {
  const teamId = req.body?.teamId ?? req.params?.teamId ?? null;

  if (!teamId) return next();

  // Validate UUID format — withTransaction uses string interpolation for SET LOCAL
  if (!UUID_RE.test(teamId)) {
    return res.status(400).json({ error: 'Invalid team ID format' });
  }

  const role = req.player?.role;
  const isAdmin = role === 'superadmin' || role === 'league_admin';

  const playerId = req.player?.id;
  if (!playerId && !isAdmin) {
    return res.status(401).json({ error: 'Player identity required' });
  }

  try {
    // Admins skip membership check — they operate on behalf of teams
    if (!isAdmin) {
      // Validate membership and load team role
      const memberResult = await query(
        `SELECT role
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

      // Expose team-level role (captain/regular/substitute) on the request
      req.teamPlayerRole = memberResult.rows[0].role;
    }

    req.teamId = teamId;

    // Store teamId in async context so withTransaction applies SET LOCAL
    requestContext.run({ teamId }, next);
  } catch (error) {
    logger.error('requireTeamContext: failed to establish team context', error);
    res.status(500).json({ error: 'Failed to verify team membership' });
  }
};

module.exports = requireTeamContext;
