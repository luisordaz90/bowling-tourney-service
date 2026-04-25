// controllers/tournamentController.js
// Tournament CRUD operations only.
const { query, withTransaction } = require('../config/database');
const { toCamelCase } = require('../utils/helpers');

const createTournament = async (req, res) => {
  try {
    const { name, description, startDate, endDate, maxTeams, totalSessions, sessionType, leagueId, editionId,
            scheduleType, rankingMethod, hdcpBase, hdcpPercentage } = req.body;

    if (!name || !startDate || !endDate || !maxTeams || !totalSessions || !sessionType) {
      return res.status(400).json({
        error: 'Name, start date, end date, max teams, total sessions, and session type are required'
      });
    }

    // Validate league and edition if provided
    if (leagueId) {
      const leagueResult = await query('SELECT id FROM leagues WHERE id = $1', [leagueId]);
      if (leagueResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid league ID' });
      }
    }

    if (editionId) {
      const editionResult = await query('SELECT id, league_id FROM tournament_editions WHERE id = $1', [editionId]);
      if (editionResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid edition ID' });
      }
      // If both leagueId and editionId are provided, ensure they match
      if (leagueId && editionResult.rows[0].league_id !== leagueId) {
        return res.status(400).json({ error: 'Edition does not belong to the specified league' });
      }
    }

    const result = await query(
      `INSERT INTO tournaments (name, description, start_date, end_date, max_teams, total_sessions, session_type,
                               league_id, edition_id, schedule_type, ranking_method, hdcp_base, hdcp_percentage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [name, description, new Date(startDate), new Date(endDate), parseInt(maxTeams), parseInt(totalSessions), sessionType,
       leagueId || null, editionId || null,
       scheduleType || 'paired', rankingMethod || 'points',
       hdcpBase != null ? parseInt(hdcpBase) : 220,
       hdcpPercentage != null ? parseFloat(hdcpPercentage) : 0.90]
    );

    res.status(201).json(toCamelCase(result.rows[0]));
  } catch (error) {
    console.error('Error creating tournament:', error);
    res.status(500).json({ error: 'Failed to create tournament' });
  }
};

const getAllTournaments = async (req, res) => {
  try {
    const result = await query('SELECT * FROM tournaments ORDER BY created_at DESC');
    res.json(toCamelCase(result.rows));
  } catch (error) {
    console.error('Error fetching tournaments:', error);
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
};

const getTournamentById = async (req, res) => {
  try {
    const result = await query('SELECT * FROM tournaments WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    res.json(toCamelCase(result.rows[0]));
  } catch (error) {
    console.error('Error fetching tournament:', error);
    res.status(500).json({ error: 'Failed to fetch tournament' });
  }
};

const updateTournament = async (req, res) => {
  try {
    const { name, description, startDate, endDate, maxTeams, totalSessions, sessionType, status, sessionsCompleted } = req.body;

    // Validate status if provided
    if (status && !['draft', 'active', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid tournament status' });
    }

    const updateFields = [];
    const updateValues = [];
    let paramCounter = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCounter++}`);
      updateValues.push(name);
    }
    if (description !== undefined) {
      updateFields.push(`description = $${paramCounter++}`);
      updateValues.push(description);
    }
    if (startDate !== undefined) {
      updateFields.push(`start_date = $${paramCounter++}`);
      updateValues.push(new Date(startDate));
    }
    if (endDate !== undefined) {
      updateFields.push(`end_date = $${paramCounter++}`);
      updateValues.push(new Date(endDate));
    }
    if (maxTeams !== undefined) {
      updateFields.push(`max_teams = $${paramCounter++}`);
      updateValues.push(parseInt(maxTeams));
    }
    if (totalSessions !== undefined) {
      updateFields.push(`total_sessions = $${paramCounter++}`);
      updateValues.push(parseInt(totalSessions));
    }
    if (sessionType !== undefined) {
      updateFields.push(`session_type = $${paramCounter++}`);
      updateValues.push(sessionType);
    }
    if (status !== undefined) {
      updateFields.push(`status = $${paramCounter++}`);
      updateValues.push(status);
    }
    if (sessionsCompleted !== undefined) {
      updateFields.push(`sessions_completed = $${paramCounter++}`);
      updateValues.push(parseInt(sessionsCompleted));
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(req.params.id);

    const result = await query(
      `UPDATE tournaments SET ${updateFields.join(', ')} WHERE id = $${paramCounter} RETURNING *`,
      updateValues
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    res.json(toCamelCase(result.rows[0]));
  } catch (error) {
    console.error('Error updating tournament:', error);
    res.status(500).json({ error: 'Failed to update tournament' });
  }
};

const deleteTournament = async (req, res) => {
  try {
    await withTransaction(async (client) => {
      // Check if tournament exists
      const tournamentResult = await client.query('SELECT id FROM tournaments WHERE id = $1', [req.params.id]);

      if (tournamentResult.rows.length === 0) {
        throw new Error('Tournament not found');
      }

      // Delete tournament (cascade will handle related records)
      await client.query('DELETE FROM tournaments WHERE id = $1', [req.params.id]);
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting tournament:', error);
    if (error.message === 'Tournament not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to delete tournament' });
  }
};

module.exports = {
  createTournament,
  getAllTournaments,
  getTournamentById,
  updateTournament,
  deleteTournament
};
