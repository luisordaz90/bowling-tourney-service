// controllers/leagueAdminController.js
const { query } = require('../config/database');
const logger = require('../config/logger');

const assignLeagueAdmin = async (req, res) => {
  try {
    const { leagueId } = req.params;
    const { playerId } = req.body;
    const assignedBy = req.player?.id ?? req.headers['x-player-id'] ?? null;

    if (!playerId) {
      return res.status(400).json({ error: 'playerId is required' });
    }

    const result = await query(
      `INSERT INTO league_admins (player_id, league_id, assigned_by)
       VALUES ($1, $2, $3)
       RETURNING player_id, league_id, assigned_at`,
      [playerId, leagueId, assignedBy]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Player is already an admin for this league' });
    }
    logger.error('Error assigning league admin:', error);
    res.status(500).json({ error: 'Failed to assign league admin' });
  }
};

const removeLeagueAdmin = async (req, res) => {
  try {
    const { leagueId, playerId } = req.params;

    const result = await query(
      'DELETE FROM league_admins WHERE player_id = $1 AND league_id = $2 RETURNING *',
      [playerId, leagueId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'League admin assignment not found' });
    }

    res.status(200).json({ message: 'League admin removed' });
  } catch (error) {
    logger.error('Error removing league admin:', error);
    res.status(500).json({ error: 'Failed to remove league admin' });
  }
};

module.exports = { assignLeagueAdmin, removeLeagueAdmin };
