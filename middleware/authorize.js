// middleware/authorize.js
// Permission-based route guard.
// Role comes from resolveRoles middleware (req.player.role).
// League scope comes from req.player.adminOfLeagues.

const logger = require('../config/logger');

// Resolves the league ID relevant to the current request.
// Checks params, body, and for tournament endpoints queries the DB.
async function resolveLeagueId(req) {
  if (req.params.leagueId) return req.params.leagueId;
  if (req.body?.leagueId) return req.body.leagueId;

  // For league routes using :id param (e.g., PUT /api/leagues/:id)
  // Check if this is a league route by looking at baseUrl
  if (req.params.id && req.baseUrl?.includes('/leagues')) {
    return req.params.id;
  }

  // Resolve tournament ID from params, body, or query
  const tournamentId = req.params.id || req.params.tournamentId || req.body?.tournamentId || req.query?.tournamentId;
  if (tournamentId) {
    const { query } = require('../config/database');
    const result = await query(
      'SELECT league_id FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    if (result.rows.length > 0) return result.rows[0].league_id;
  }

  return null;
}

const PERMISSIONS = {
  'player:create': (req) => req.player.role === 'superadmin' || req.player.role === 'league_admin',

  // Admins can edit any player; players can edit their own profile
  'player:update': (req) => {
    if (req.player.role === 'superadmin' || req.player.role === 'league_admin') return true;
    return !!req.player.id && req.player.id === req.params.id;
  },

  'league:create': (req) => req.player.role === 'superadmin',

  'league:update': async (req) => {
    if (req.player.role === 'superadmin') return true;
    if (req.player.role === 'league_admin') {
      const leagueId = await resolveLeagueId(req);
      return leagueId && req.player.adminOfLeagues.includes(leagueId);
    }
    return false;
  },

  'league:admin:manage': (req) => req.player.role === 'superadmin',

  'tournament:create': async (req) => {
    if (req.player.role === 'superadmin') return true;
    if (req.player.role === 'league_admin') {
      const leagueId = await resolveLeagueId(req);
      return leagueId && req.player.adminOfLeagues.includes(leagueId);
    }
    return false;
  },

  'tournament:update': async (req) => {
    if (req.player.role === 'superadmin') return true;
    if (req.player.role === 'league_admin') {
      const leagueId = await resolveLeagueId(req);
      return leagueId && req.player.adminOfLeagues.includes(leagueId);
    }
    return false;
  },

  'tournament:delete': async (req) => {
    if (req.player.role === 'superadmin') return true;
    if (req.player.role === 'league_admin') {
      const leagueId = await resolveLeagueId(req);
      return leagueId && req.player.adminOfLeagues.includes(leagueId);
    }
    return false;
  },

  'session:create': async (req) => {
    if (req.player.role === 'superadmin') return true;
    if (req.player.role === 'league_admin') {
      const leagueId = await resolveLeagueId(req);
      return leagueId && req.player.adminOfLeagues.includes(leagueId);
    }
    return false;
  },

  'session:update': async (req) => {
    if (req.player.role === 'superadmin') return true;
    if (req.player.role === 'league_admin') {
      const leagueId = await resolveLeagueId(req);
      return leagueId && req.player.adminOfLeagues.includes(leagueId);
    }
    return false;
  },

  'schedule:generate': async (req) => {
    if (req.player.role === 'superadmin') return true;
    if (req.player.role === 'league_admin') {
      const leagueId = await resolveLeagueId(req);
      return leagueId && req.player.adminOfLeagues.includes(leagueId);
    }
    return false;
  },

  'schedule:delete': async (req) => {
    if (req.player.role === 'superadmin') return true;
    if (req.player.role === 'league_admin') {
      const leagueId = await resolveLeagueId(req);
      return leagueId && req.player.adminOfLeagues.includes(leagueId);
    }
    return false;
  },

  // Score permissions — admin/league_admin have full access; captains can submit for their team
  'score:submit': (req) => {
    if (req.player.role === 'superadmin' || req.player.role === 'league_admin') return true;
    return req.player.role === 'player' && req.teamPlayerRole === 'captain';
  },

  'score:update': (req) => {
    return req.player.role === 'superadmin' || req.player.role === 'league_admin';
  },

  'score:delete': (req) => {
    return req.player.role === 'superadmin' || req.player.role === 'league_admin';
  },

  // Match permissions
  'match:create': async (req) => {
    if (req.player.role === 'superadmin') return true;
    if (req.player.role === 'league_admin') {
      const leagueId = await resolveLeagueId(req);
      return leagueId && req.player.adminOfLeagues.includes(leagueId);
    }
    return false;
  },

  'match:update': async (req) => {
    if (req.player.role === 'superadmin') return true;
    if (req.player.role === 'league_admin') {
      const leagueId = await resolveLeagueId(req);
      return leagueId && req.player.adminOfLeagues.includes(leagueId);
    }
    return false;
  },

  'statistics:update': (req) => {
    return req.player.role === 'superadmin' || req.player.role === 'league_admin';
  },
};

function authorize(permission) {
  return async (req, res, next) => {
    const check = PERMISSIONS[permission];
    if (!check) {
      logger.error({ permission }, 'Unknown permission requested');
      return res.status(500).json({ error: 'Internal authorization error' });
    }

    try {
      const allowed = await check(req);
      if (!allowed) {
        logger.warn({
          permission,
          playerId: req.player?.id,
          role: req.player?.role,
        }, 'Authorization denied');
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = authorize;
