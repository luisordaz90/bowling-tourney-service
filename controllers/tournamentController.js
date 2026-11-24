// controllers/tournamentController.js
// Tournament CRUD operations only.
const { query, withTransaction } = require('../config/database');
const { toCamelCase } = require('../utils/helpers');

const createTournament = async (req, res) => {
  try {
    const { name, description, startDate, endDate, maxTeams, totalSessions, sessionType, leagueId,
            scheduleType, rankingMethod, scoringConfig, season, year, lineupSize,
            // Legacy fields — mapped into scoringConfig for backwards compatibility
            hdcpBase, hdcpPercentage, gamesPerSession } = req.body;

    if (!name || !startDate || !endDate || !maxTeams || !totalSessions || !sessionType || !leagueId) {
      return res.status(400).json({
        error: 'Name, start date, end date, max teams, total sessions, session type, and league ID are required'
      });
    }

    // Validate league exists
    const leagueResult = await query('SELECT id FROM leagues WHERE id = $1', [leagueId]);
    if (leagueResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid league ID' });
    }

    // Build scoring_config: prefer explicit scoringConfig, fall back to legacy fields, then defaults
    const config = scoringConfig || {};
    const finalConfig = {
      games_per_session: config.games_per_session || (gamesPerSession != null ? parseInt(gamesPerSession) : 3),
      handicap: {
        base_score: config.handicap?.base_score || (hdcpBase != null ? parseInt(hdcpBase) : 220),
        percentage: config.handicap?.percentage || (hdcpPercentage != null ? Math.round(parseFloat(hdcpPercentage) * 100) : 90),
        floor: config.handicap?.floor ?? 0,
        cap: config.handicap?.cap ?? null,
      },
      points: {
        per_game_win: config.points?.per_game_win ?? 1,
        per_game_tie: config.points?.per_game_tie ?? 0.5,
        per_series_win: config.points?.per_series_win ?? 1,
        per_series_tie: config.points?.per_series_tie ?? 0.5,
        bonus_categories: config.points?.bonus_categories ?? [],
        per_bonus: config.points?.per_bonus ?? 1,
      },
    };

    const result = await query(
      `INSERT INTO tournaments (name, description, start_date, end_date, max_teams, total_sessions, session_type,
                               league_id, schedule_type, ranking_method, scoring_config, season, year, lineup_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [name, description, new Date(startDate), new Date(endDate), parseInt(maxTeams), parseInt(totalSessions), sessionType,
       leagueId,
       scheduleType || 'paired', rankingMethod || 'points',
       JSON.stringify(finalConfig),
       season || null, year != null ? parseInt(year) : null,
       lineupSize != null ? parseInt(lineupSize) : 3]
    );

    res.status(201).json(toCamelCase(result.rows[0]));
  } catch (error) {
    console.error('Error creating tournament:', error);
    res.status(500).json({ error: 'Failed to create tournament' });
  }
};

const getAllTournaments = async (req, res) => {
  try {
    const { leagueId } = req.query;
    let sql = `SELECT t.*,
              (SELECT COUNT(*) FROM tournament_sessions ts
               WHERE ts.tournament_id = t.id AND ts.status = 'completed')::int AS sessions_completed
       FROM tournaments t`;
    const params = [];
    if (leagueId) {
      params.push(leagueId);
      sql += ` WHERE t.league_id = $1`;
    }
    sql += ` ORDER BY t.created_at DESC`;
    const result = await query(sql, params);
    res.json(toCamelCase(result.rows));
  } catch (error) {
    console.error('Error fetching tournaments:', error);
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
};

const getTournamentById = async (req, res) => {
  try {
    const result = await query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM tournament_sessions ts
               WHERE ts.tournament_id = t.id AND ts.status = 'completed')::int AS sessions_completed
       FROM tournaments t WHERE t.id = $1`,
      [req.params.id]
    );

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
