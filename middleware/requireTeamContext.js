// middleware/requireTeamContext.js
//
// Validates that the authenticated player is an active member of the team
// being targeted by the request, then exposes the resolved teamId as req.teamId
// so controllers can call withTeamContext(req.teamId, ...) for RLS-scoped writes.
//
// Must run after jwtCheck + requirePlayer so that req.player is populated.
//
// teamId resolution order:
//   1. req.body.teamId       — score submissions, team score calculation
//   2. req.params.teamId     — nested tournament/team routes
//   3. req.params.id         — direct team routes (PUT /teams/:id)
//
// Requests with no resolvable teamId are passed through unchanged — this covers
// admin operations, public reads, and routes that don't target a specific team.

const { query } = require('../config/database');
const logger = require('../config/logger');

const requireTeamContext = async (req, res, next) => {
  const teamId = req.body?.teamId ?? req.params?.teamId ?? req.params?.id ?? null;

  // No team target on this request — skip membership check
  if (!teamId) return next();

  const playerId = req.player?.id;
  if (!playerId) {
    return res.status(401).json({ error: 'Player identity required' });
  }

  try {
    const result = await query(
      `SELECT 1
       FROM   team_players
       WHERE  player_id = $1
         AND  team_id   = $2
         AND  is_active = true
       LIMIT  1`,
      [playerId, teamId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    req.teamId = teamId;
    next();
  } catch (error) {
    logger.error('requireTeamContext: membership check failed', error);
    res.status(500).json({ error: 'Failed to verify team membership' });
  }
};

module.exports = requireTeamContext;
