// controllers/leagueController.js
const { query, withTransaction } = require('../config/database');
const { toCamelCase } = require('../utils/helpers');

// League Management

const createLeague = async (req, res) => {
  try {
    const { name, description, leagueType, maxTeamsPerTournament } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'League name is required' });
    }

    const result = await query(
      `INSERT INTO leagues (name, description, league_type, max_teams_per_tournament)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, description || null, leagueType || 'standard', maxTeamsPerTournament || null]
    );

    res.status(201).json(toCamelCase(result.rows[0]));
  } catch (error) {
    console.error('Error creating league:', error);
    
    if (error.code === '23505' && error.constraint === 'leagues_name_key') {
      return res.status(400).json({ error: 'League name already exists' });
    }
    
    res.status(500).json({ error: 'Failed to create league' });
  }
};

const getLeagues = async (req, res) => {
  try {
    const { status, leagueType } = req.query;
    
    let queryText = 'SELECT * FROM leagues WHERE 1=1';
    const queryParams = [];
    let paramCounter = 1;
    
    if (status) {
      queryText += ` AND status = $${paramCounter++}`;
      queryParams.push(status);
    }
    
    if (leagueType) {
      queryText += ` AND league_type = $${paramCounter++}`;
      queryParams.push(leagueType);
    }
    
    queryText += ' ORDER BY name';
    
    const result = await query(queryText, queryParams);
    res.json(toCamelCase(result.rows));
  } catch (error) {
    console.error('Error fetching leagues:', error);
    res.status(500).json({ error: 'Failed to fetch leagues' });
  }
};

const getLeagueById = async (req, res) => {
  try {
    const result = await query('SELECT * FROM leagues WHERE id = $1', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'League not found' });
    }
    
    res.json(toCamelCase(result.rows[0]));
  } catch (error) {
    console.error('Error fetching league:', error);
    res.status(500).json({ error: 'Failed to fetch league' });
  }
};

const updateLeague = async (req, res) => {
  try {
    const { name, description, leagueType, status, maxTeamsPerTournament } = req.body;

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
    if (leagueType !== undefined) {
      updateFields.push(`league_type = $${paramCounter++}`);
      updateValues.push(leagueType);
    }
    if (status !== undefined) {
      updateFields.push(`status = $${paramCounter++}`);
      updateValues.push(status);
    }
    if (maxTeamsPerTournament !== undefined) {
      updateFields.push(`max_teams_per_tournament = $${paramCounter++}`);
      updateValues.push(maxTeamsPerTournament);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(req.params.id);

    const result = await query(
      `UPDATE leagues SET ${updateFields.join(', ')} WHERE id = $${paramCounter} RETURNING *`,
      updateValues
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'League not found' });
    }

    res.json(toCamelCase(result.rows[0]));
  } catch (error) {
    console.error('Error updating league:', error);
    
    if (error.code === '23505' && error.constraint === 'leagues_name_key') {
      return res.status(400).json({ error: 'League name already exists' });
    }
    
    res.status(500).json({ error: 'Failed to update league' });
  }
};

// Validation and Eligibility Endpoints

const validatePlayerTeamAssignment = async (req, res) => {
  try {
    const { playerId, teamId, tournamentId } = req.body;
    
    if (!playerId || !teamId || !tournamentId) {
      return res.status(400).json({ 
        error: 'Player ID, team ID, and tournament ID are required' 
      });
    }

    // Get tournament and league info
    const tournamentResult = await query(
      'SELECT id, league_id, status FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    
    const tournament = tournamentResult.rows[0];
    const validation = {
      isValid: true,
      violations: [],
      warnings: []
    };

    // Check if player is already on another team in the same league
    const existingAssignmentResult = await query(
      `SELECT t.name as team_name, tournament.name as tournament_name
       FROM team_players tp
       JOIN teams t ON tp.team_id = t.id
       JOIN tournaments tournament ON tp.tournament_id = tournament.id
       WHERE tp.player_id = $1 
       AND tp.team_id != $2
       AND tp.is_active = true
       AND tournament.league_id = $3
       AND tournament.status IN ('active', 'draft')`,
      [playerId, teamId, tournament.league_id]
    );
    
    if (existingAssignmentResult.rows.length > 0) {
      validation.isValid = false;
      validation.violations.push({
        type: 'multiple_teams_in_league',
        message: `Player is already assigned to team "${existingAssignmentResult.rows[0].team_name}" in tournament "${existingAssignmentResult.rows[0].tournament_name}" for this league`,
        conflictingTeam: existingAssignmentResult.rows[0].team_name,
        conflictingTournament: existingAssignmentResult.rows[0].tournament_name
      });
    }
    
    // Check player eligibility for the league
    const eligibilityResult = await query(
      `SELECT status, reason, expiry_date
       FROM player_league_eligibility
       WHERE player_id = $1 AND league_id = $2`,
      [playerId, tournament.league_id]
    );
    
    if (eligibilityResult.rows.length > 0) {
      const eligibility = eligibilityResult.rows[0];
      if (eligibility.status !== 'eligible') {
        const isExpired = eligibility.expiry_date && new Date(eligibility.expiry_date) < new Date();
        
        if (!isExpired) {
          validation.isValid = false;
          validation.violations.push({
            type: 'player_ineligible',
            message: `Player is ${eligibility.status} in this league`,
            reason: eligibility.reason,
            expiryDate: eligibility.expiry_date
          });
        } else {
          validation.warnings.push({
            type: 'expired_ineligibility',
            message: 'Player had expired ineligibility record in this league'
          });
        }
      }
    }
    
    res.json(toCamelCase(validation));
  } catch (error) {
    console.error('Error validating player team assignment:', error);
    res.status(500).json({ error: 'Failed to validate player team assignment' });
  }
};

const getPlayerLeagueHistory = async (req, res) => {
  try {
    const { includeInactive } = req.query;
    
    let queryText = `
      SELECT DISTINCT l.id as league_id, l.name as league_name, l.league_type,
             t.id as team_id, t.name as team_name, tp.role, tp.joined_date, tp.left_date,
             tournament.id as tournament_id, tournament.name as tournament_name,
             tournament.status as tournament_status, tournament.year, tournament.season
      FROM team_players tp
      JOIN teams t ON tp.team_id = t.id
      JOIN tournaments tournament ON tp.tournament_id = tournament.id
      JOIN leagues l ON tournament.league_id = l.id
      WHERE tp.player_id = $1`;

    const queryParams = [req.params.playerId];

    if (!includeInactive || includeInactive === 'false') {
      queryText += ' AND tp.is_active = true';
    }

    queryText += ' ORDER BY tournament.year DESC, tp.joined_date DESC';
    
    const result = await query(queryText, queryParams);
    res.json(toCamelCase(result.rows));
  } catch (error) {
    console.error('Error fetching player league history:', error);
    res.status(500).json({ error: 'Failed to fetch player league history' });
  }
};

const getLeagueViolations = async (req, res) => {
  try {
    const { status, violationType } = req.query;
    
    let queryText = `
      SELECT tlv.*, t.name as team_name, l.name as league_name,
             p.name as player_name
      FROM team_league_violations tlv
      JOIN teams t ON tlv.team_id = t.id
      JOIN leagues l ON tlv.league_id = l.id
      LEFT JOIN players p ON tlv.player_id = p.id
      WHERE tlv.league_id = $1`;
    
    const queryParams = [req.params.leagueId];
    let paramCounter = 2;
    
    if (status) {
      queryText += ` AND tlv.status = $${paramCounter++}`;
      queryParams.push(status);
    }
    
    if (violationType) {
      queryText += ` AND tlv.violation_type = $${paramCounter++}`;
      queryParams.push(violationType);
    }
    
    queryText += ' ORDER BY tlv.detected_at DESC';
    
    const result = await query(queryText, queryParams);
    res.json(toCamelCase(result.rows));
  } catch (error) {
    console.error('Error fetching league violations:', error);
    res.status(500).json({ error: 'Failed to fetch league violations' });
  }
};

module.exports = {
  // League management
  createLeague,
  getLeagues,
  getLeagueById,
  updateLeague,
  // Validation and eligibility
  validatePlayerTeamAssignment,
  getPlayerLeagueHistory,
  getLeagueViolations
};