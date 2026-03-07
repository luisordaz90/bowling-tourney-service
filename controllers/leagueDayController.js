// controllers/leagueDayController.js
// League days map to league_sessions in the database.
// Field mapping: week → session_number, date → session_date, description → session_name
const { query } = require('../config/database');
const logger = require('../config/logger');

const VALID_STATUSES = ['scheduled', 'active', 'completed', 'cancelled'];

const createLeagueDay = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { date, week, description } = req.body;

    if (!date || !week) {
      return res.status(400).json({ error: 'Date and week are required' });
    }

    const tournamentResult = await query(
      'SELECT id FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const result = await query(
      `INSERT INTO league_sessions (tournament_id, session_number, session_name, session_date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tournamentId, parseInt(week), description || `Week ${week}`, new Date(date)]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A session for this week already exists in the tournament' });
    }
    logger.error('Error creating league day:', error);
    res.status(500).json({ error: 'Failed to create league day' });
  }
};

const getLeagueDaysByTournament = async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM league_sessions WHERE tournament_id = $1 ORDER BY session_number',
      [req.params.tournamentId]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching league days:', error);
    res.status(500).json({ error: 'Failed to fetch league days' });
  }
};

const updateLeagueDayStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`
      });
    }

    const result = await query(
      'UPDATE league_sessions SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'League day not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error updating league day status:', error);
    res.status(500).json({ error: 'Failed to update league day status' });
  }
};

module.exports = {
  createLeagueDay,
  getLeagueDaysByTournament,
  updateLeagueDayStatus
};
