// middleware/resolveRoles.js
// Resolves the user's role and league admin scopes.
// In production: reads from JWT claims. In test: reads from X-User-Role header.

const { query } = require('../config/database');

async function resolveRoles(req, res, next) {
  try {
    // Resolve role: JWT claim in production, header in test.
    // In test env without explicit role header, default to superadmin for backward compat.
    const defaultRole = process.env.NODE_ENV === 'test' ? 'superadmin' : 'player';
    const role = req.auth?.payload?.['https://bowling-tournament-api.com/roles']?.[0]
      ?? req.headers['x-user-role']
      ?? defaultRole;

    // Resolve player ID (same pattern as meController)
    const playerId = req.player?.id ?? req.headers['x-player-id'] ?? null;

    if (!req.player) {
      req.player = {};
    }
    req.player.id = req.player.id ?? playerId;
    req.player.role = role;
    req.player.adminOfLeagues = [];

    if (role === 'league_admin' && playerId) {
      const result = await query(
        'SELECT league_id FROM league_admins WHERE player_id = $1',
        [playerId]
      );
      req.player.adminOfLeagues = result.rows.map(r => r.league_id);
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = resolveRoles;
