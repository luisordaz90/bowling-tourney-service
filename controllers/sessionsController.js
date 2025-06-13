// controllers/sessionsController.js
const { query } = require('../config/database');

const updateSessionStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['scheduled', 'active', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await query(
      `UPDATE league_sessions SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'League session not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating session status:', error);
    res.status(500).json({ error: 'Failed to update session status' });
  }
};

const getSessionById = async (req, res) => {
  try {
    const result = await query(
      `SELECT ls.*, t.name as tournament_name
       FROM league_sessions ls
       JOIN tournaments t ON ls.tournament_id = t.id
       WHERE ls.id = $1`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'League session not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
};

const getSessionsByTournament = async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM league_sessions 
       WHERE tournament_id = $1 
       ORDER BY session_number`,
      [req.params.tournamentId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tournament sessions:', error);
    res.status(500).json({ error: 'Failed to fetch tournament sessions' });
  }
};

const createSession = async (req, res) => {
  try {
    const { sessionNumber, sessionName, sessionDate, notes } = req.body;
    
    if (!sessionNumber || !sessionDate) {
      return res.status(400).json({ error: 'Session number and session date are required' });
    }

    // Check if tournament exists
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const result = await query(
      `INSERT INTO league_sessions (tournament_id, session_number, session_name, session_date, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.params.tournamentId, parseInt(sessionNumber), sessionName || `Session ${sessionNumber}`, new Date(sessionDate), notes || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating session:', error);
    
    // Handle unique constraint violations
    if (error.code === '23505') {
      if (error.constraint === 'league_sessions_tournament_id_session_number_key') {
        return res.status(400).json({ error: 'Session number already exists for this tournament' });
      }
    }
    
    res.status(500).json({ error: 'Failed to create session' });
  }
};

const deleteSession = async (req, res) => {
  try {
    // Check if session has associated matches
    const matchesResult = await query(
      'SELECT COUNT(*) FROM matches WHERE session_id = $1',
      [req.params.id]
    );
    
    if (parseInt(matchesResult.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete session with associated matches. Delete matches first.' 
      });
    }

    const result = await query('DELETE FROM league_sessions WHERE id = $1 RETURNING id', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'League session not found' });
    }
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
};

const updateSession = async (req, res) => {
  try {
    const { sessionName, sessionDate, notes, status } = req.body;

    // Validate status if provided
    if (status && !['scheduled', 'active', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid session status' });
    }

    const updateFields = [];
    const updateValues = [];
    let paramCounter = 1;

    if (sessionName !== undefined) {
      updateFields.push(`session_name = $${paramCounter++}`);
      updateValues.push(sessionName);
    }
    if (sessionDate !== undefined) {
      updateFields.push(`session_date = $${paramCounter++}`);
      updateValues.push(new Date(sessionDate));
    }
    if (notes !== undefined) {
      updateFields.push(`notes = $${paramCounter++}`);
      updateValues.push(notes);
    }
    if (status !== undefined) {
      updateFields.push(`status = $${paramCounter++}`);
      updateValues.push(status);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateValues.push(req.params.id);

    const result = await query(
      `UPDATE league_sessions SET ${updateFields.join(', ')} WHERE id = $${paramCounter} RETURNING *`,
      updateValues
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'League session not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
};

module.exports = {
  updateSessionStatus,
  getSessionById,
  getSessionsByTournament,
  createSession,
  deleteSession,
  updateSession
};