// controllers/sessionsController.js
// Flat session endpoints — tournamentId comes from body/query instead of URL params.
const { query, withTransaction } = require('../config/database');
const { toCamelCase } = require('../utils/helpers');

const createSession = async (req, res) => {
  try {
    const { tournamentId, sessionNumber, sessionName, sessionDate, notes } = req.body;

    if (!tournamentId || !sessionNumber || !sessionDate) {
      return res.status(400).json({ error: 'tournamentId, sessionNumber, and sessionDate are required' });
    }

    await withTransaction(async (client) => {
      const tournamentResult = await client.query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);
      if (tournamentResult.rows.length === 0) throw new Error('Tournament not found');

      const existingResult = await client.query(
        'SELECT id FROM tournament_sessions WHERE tournament_id = $1 AND session_number = $2',
        [tournamentId, parseInt(sessionNumber)]
      );
      if (existingResult.rows.length > 0) throw new Error('Session number already exists for this tournament');

      const result = await client.query(
        `INSERT INTO tournament_sessions (tournament_id, session_number, session_name, session_date, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [tournamentId, parseInt(sessionNumber), sessionName || `Session ${sessionNumber}`, new Date(sessionDate), notes || null]
      );

      res.status(201).json(toCamelCase(result.rows[0]));
    });
  } catch (error) {
    if (['Tournament not found', 'Session number already exists for this tournament'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create session' });
  }
};

const getSessions = async (req, res) => {
  try {
    const { tournamentId } = req.query;
    if (!tournamentId) return res.status(400).json({ error: 'tournamentId query param is required' });

    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);
    if (tournamentResult.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });

    const sessionsResult = await query(
      `SELECT ls.*,
              COUNT(m.id) as match_count,
              COUNT(CASE WHEN m.status = 'completed' THEN 1 END) as completed_matches,
              COUNT(CASE WHEN m.status = 'scheduled' THEN 1 END) as scheduled_matches,
              COUNT(CASE WHEN m.status = 'in_progress' THEN 1 END) as in_progress_matches
       FROM tournament_sessions ls
       LEFT JOIN matches m ON ls.id = m.session_id
       WHERE ls.tournament_id = $1
       GROUP BY ls.id
       ORDER BY ls.session_number`,
      [tournamentId]
    );

    const enriched = sessionsResult.rows.map(session => ({
      ...toCamelCase(session),
      matchCount: parseInt(session.match_count),
      completedMatches: parseInt(session.completed_matches),
      scheduledMatches: parseInt(session.scheduled_matches),
      inProgressMatches: parseInt(session.in_progress_matches),
      isComplete: parseInt(session.match_count) > 0 && parseInt(session.completed_matches) === parseInt(session.match_count)
    }));

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
};

const updateSessionStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!['scheduled', 'active', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await query(
      'UPDATE tournament_sessions SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    res.json(toCamelCase(result.rows[0]));
  } catch (error) {
    res.status(500).json({ error: 'Failed to update session status' });
  }
};

module.exports = { createSession, getSessions, updateSessionStatus };
