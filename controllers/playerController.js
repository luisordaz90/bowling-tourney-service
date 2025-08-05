// controllers/playerController.js
const { query, withTransaction } = require('../config/database');
const { toCamelCase } = require('../utils/helpers');

const createPlayer = async (req, res) => {
  try {
    const { name, email, phone, handicap } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    const result = await query(
      `INSERT INTO players (name, email, phone, handicap)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, email || null, phone || null, handicap ? parseInt(handicap) : 0]
    );

    res.status(201).json(toCamelCase(result.rows[0]));
  } catch (error) {
    console.error('Error creating player:', error);
    
    // Handle unique constraint violations
    if (error.code === '23505') {
      if (error.constraint === 'players_email_key') {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }
    
    res.status(500).json({ error: 'Failed to create player' });
  }
};

const getPlayers = async (req, res) => {
  try {
    const result = await query('SELECT * FROM players ORDER BY name');
    res.json((result.rows));
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
};

const getPlayerById = async (req, res) => {
  try {
    const result = await query('SELECT * FROM players WHERE id = $1', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    res.json((result.rows[0]));
  } catch (error) {
    console.error('Error fetching player:', error);
    res.status(500).json({ error: 'Failed to fetch player' });
  }
};

const updatePlayer = async (req, res) => {
  try {
    const { name, email, phone, handicap } = req.body;

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    const updateFields = [];
    const updateValues = [];
    let paramCounter = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCounter++}`);
      updateValues.push(name);
    }
    if (email !== undefined) {
      updateFields.push(`email = $${paramCounter++}`);
      updateValues.push(email);
    }
    if (phone !== undefined) {
      updateFields.push(`phone = $${paramCounter++}`);
      updateValues.push(phone);
    }
    if (handicap !== undefined) {
      updateFields.push(`handicap = $${paramCounter++}`);
      updateValues.push(parseInt(handicap));
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(req.params.id);

    const result = await query(
      `UPDATE players SET ${updateFields.join(', ')} WHERE id = $${paramCounter} RETURNING *`,
      updateValues
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    res.json((result.rows[0]));
  } catch (error) {
    console.error('Error updating player:', error);
    
    // Handle unique constraint violations
    if (error.code === '23505') {
      if (error.constraint === 'players_email_key') {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }
    
    res.status(500).json({ error: 'Failed to update player' });
  }
};

const deletePlayer = async (req, res) => {
  try {
    await withTransaction(async (client) => {
      // Check if player exists
      const playerResult = await client.query('SELECT id FROM players WHERE id = $1', [req.params.id]);
      if (playerResult.rows.length === 0) {
        throw new Error('Player not found');
      }

      // Check if player has recorded scores
      const scoresResult = await client.query(
        'SELECT COUNT(*) FROM player_match_scores WHERE player_id = $1',
        [req.params.id]
      );
      
      if (parseInt(scoresResult.rows[0].count) > 0) {
        throw new Error('Cannot delete player with recorded match scores. Player data is needed for historical records.');
      }

      // Delete the player (cascade will handle related records)
      await client.query('DELETE FROM players WHERE id = $1', [req.params.id]);
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting player:', error);
    
    if (error.message === 'Player not found') {
      return res.status(404).json({ error: error.message });
    }
    
    if (error.message.includes('Cannot delete player with recorded match scores')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to delete player' });
  }
};

const getPlayersByTeam = async (req, res) => {
  try {
    const result = await query(
      `SELECT p.*, tp.role, tp.is_active, tp.joined_date, tp.left_date
       FROM players p
       JOIN team_players tp ON p.id = tp.player_id
       WHERE tp.team_id = $1 AND tp.is_active = true
       ORDER BY tp.role, p.name`,
      [req.params.teamId]
    );
    
    res.json((result.rows));
  } catch (error) {
    console.error('Error fetching team players:', error);
    res.status(500).json({ error: 'Failed to fetch team players' });
  }
};

// New player-centric endpoints

const getPlayerDashboard = async (req, res) => {
  try {
    const playerId = req.params.playerId;
    
    // Check if player exists
    const playerResult = await query('SELECT * FROM players WHERE id = $1', [playerId]);
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    const player = playerResult.rows[0];
    
    // Get current active teams
    const currentTeamsResult = await query(
      `SELECT DISTINCT t.id, t.name, t.captain_name, tournament.name as tournament_name, 
              tournament.id as tournament_id, tournament.status as tournament_status,
              tp.role, tp.joined_date
       FROM teams t
       JOIN team_players tp ON t.id = tp.team_id
       JOIN tournaments tournament ON tp.tournament_id = tournament.id
       WHERE tp.player_id = $1 AND tp.is_active = true
       ORDER BY tournament.start_date DESC`,
      [playerId]
    );
    
    // Get overall statistics across all tournaments
    const overallStatsResult = await query(
      `SELECT 
         COUNT(DISTINCT ps.tournament_id) as tournaments_played,
         COALESCE(SUM(ps.games_played), 0) as total_games,
         COALESCE(SUM(ps.total_pins), 0) as total_pins,
         COALESCE(AVG(ps.current_average), 0) as overall_average,
         COALESCE(MAX(ps.highest_game), 0) as career_high_game,
         COALESCE(MAX(ps.highest_series), 0) as career_high_series,
         COALESCE(SUM(ps.matches_played), 0) as total_matches
       FROM player_statistics ps
       WHERE ps.player_id = $1`,
      [playerId]
    );
    
    // Get recent tournament statistics
    const recentStatsResult = await query(
      `SELECT ps.*, t.name as tournament_name, t.status as tournament_status,
              t.start_date, t.end_date
       FROM player_statistics ps
       JOIN tournaments t ON ps.tournament_id = t.id
       WHERE ps.player_id = $1
       ORDER BY t.start_date DESC
       LIMIT 5`,
      [playerId]
    );
    
    // Get recent match scores
    const recentScoresResult = await query(
      `SELECT pms.*, m.match_date, 
              ht.name as home_team_name, at.name as away_team_name,
              t.name as tournament_name
       FROM player_match_scores pms
       JOIN matches m ON pms.match_id = m.id
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at ON m.away_team_id = at.id
       JOIN tournaments t ON m.tournament_id = t.id
       WHERE pms.player_id = $1
       ORDER BY m.match_date DESC
       LIMIT 10`,
      [playerId]
    );
    
    const dashboard = {
      player: toCamelCase(player),
      currentTeams: toCamelCase(currentTeamsResult.rows),
      overallStatistics: toCamelCase(overallStatsResult.rows[0] || {}),
      recentTournamentStats: toCamelCase(recentStatsResult.rows),
      recentScores: toCamelCase(recentScoresResult.rows)
    };
    
    res.json(dashboard);
  } catch (error) {
    console.error('Error fetching player dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch player dashboard' });
  }
};

const getPlayerTeams = async (req, res) => {
  try {
    const playerId = req.params.playerId;
    const { tournamentId, status, includeInactive } = req.query;
    
    // Check if player exists
    const playerResult = await query('SELECT id FROM players WHERE id = $1', [playerId]);
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    let queryText = `
      SELECT t.id, t.name, t.captain_name, t.captain_email, t.status as team_status,
             tp.role, tp.is_active, tp.joined_date, tp.left_date,
             tournament.id as tournament_id, tournament.name as tournament_name,
             tournament.status as tournament_status, tournament.start_date, tournament.end_date
      FROM teams t
      JOIN team_players tp ON t.id = tp.team_id
      JOIN tournaments tournament ON tp.tournament_id = tournament.id
      WHERE tp.player_id = $1`;
    
    const queryParams = [playerId];
    let paramCounter = 2;
    
    // Add filters
    if (tournamentId) {
      queryText += ` AND tournament.id = $${paramCounter++}`;
      queryParams.push(tournamentId);
    }
    
    if (status) {
      queryText += ` AND tournament.status = $${paramCounter++}`;
      queryParams.push(status);
    }
    
    if (!includeInactive || includeInactive === 'false') {
      queryText += ` AND tp.is_active = true`;
    }
    
    queryText += ` ORDER BY tournament.start_date DESC, tp.joined_date DESC`;
    
    const result = await query(queryText, queryParams);
    res.json(toCamelCase(result.rows));
  } catch (error) {
    console.error('Error fetching player teams:', error);
    res.status(500).json({ error: 'Failed to fetch player teams' });
  }
};

const getPlayerStatistics = async (req, res) => {
  try {
    const playerId = req.params.playerId;
    const { tournamentId, status } = req.query;
    
    // Check if player exists
    const playerResult = await query('SELECT id FROM players WHERE id = $1', [playerId]);
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    let queryText = `
      SELECT ps.*, t.name as tournament_name, t.status as tournament_status,
             t.start_date, t.end_date, t.session_type
      FROM player_statistics ps
      JOIN tournaments t ON ps.tournament_id = t.id
      WHERE ps.player_id = $1`;
    
    const queryParams = [playerId];
    let paramCounter = 2;
    
    // Add filters
    if (tournamentId) {
      queryText += ` AND t.id = $${paramCounter++}`;
      queryParams.push(tournamentId);
    }
    
    if (status) {
      queryText += ` AND t.status = $${paramCounter++}`;
      queryParams.push(status);
    }
    
    queryText += ` ORDER BY t.start_date DESC`;
    
    const result = await query(queryText, queryParams);
    res.json(toCamelCase(result.rows));
  } catch (error) {
    console.error('Error fetching player statistics:', error);
    res.status(500).json({ error: 'Failed to fetch player statistics' });
  }
};

module.exports = {
  createPlayer,
  getPlayers,
  getPlayerById,
  updatePlayer,
  deletePlayer,
  getPlayersByTeam,
  getPlayerDashboard,
  getPlayerTeams,
  getPlayerStatistics
};