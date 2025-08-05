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

// Tournament Edition Management

const createTournamentEdition = async (req, res) => {
  try {
    const { leagueId, name, season, year, startDate, endDate, maxTeams, totalSessions, sessionType } = req.body;
    
    if (!leagueId || !name || !year || !startDate || !endDate) {
      return res.status(400).json({ 
        error: 'League ID, name, year, start date, and end date are required' 
      });
    }

    await withTransaction(async (client) => {
      // Verify league exists
      const leagueResult = await client.query('SELECT id FROM leagues WHERE id = $1', [leagueId]);
      if (leagueResult.rows.length === 0) {
        throw new Error('League not found');
      }

      // Get the next edition number for this league
      const editionNumberResult = await client.query(
        'SELECT COALESCE(MAX(edition_number), 0) + 1 as next_edition FROM tournament_editions WHERE league_id = $1',
        [leagueId]
      );
      const editionNumber = editionNumberResult.rows[0].next_edition;

      // Create the tournament edition
      const result = await client.query(
        `INSERT INTO tournament_editions (
          league_id, edition_number, name, season, year, start_date, end_date, 
          max_teams, total_sessions, session_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          leagueId, editionNumber, name, season || null, parseInt(year),
          new Date(startDate), new Date(endDate), maxTeams || null,
          totalSessions || 1, sessionType || 'weekly'
        ]
      );

      res.status(201).json(toCamelCase(result.rows[0]));
    });
  } catch (error) {
    console.error('Error creating tournament edition:', error);
    
    if (error.message === 'League not found') {
      return res.status(404).json({ error: error.message });
    }
    
    if (error.code === '23505') {
      if (error.constraint === 'tournament_editions_league_id_name_key') {
        return res.status(400).json({ error: 'Edition name already exists in this league' });
      }
    }
    
    res.status(500).json({ error: 'Failed to create tournament edition' });
  }
};

const getLeagueEditions = async (req, res) => {
  try {
    const { year, season, status } = req.query;
    
    let queryText = `
      SELECT te.*, l.name as league_name, l.league_type
      FROM tournament_editions te
      JOIN leagues l ON te.league_id = l.id
      WHERE te.league_id = $1`;
    
    const queryParams = [req.params.leagueId];
    let paramCounter = 2;
    
    if (year) {
      queryText += ` AND te.year = $${paramCounter++}`;
      queryParams.push(parseInt(year));
    }
    
    if (season) {
      queryText += ` AND te.season = $${paramCounter++}`;
      queryParams.push(season);
    }
    
    if (status) {
      queryText += ` AND te.status = $${paramCounter++}`;
      queryParams.push(status);
    }
    
    queryText += ' ORDER BY te.year DESC, te.edition_number DESC';
    
    const result = await query(queryText, queryParams);
    res.json(toCamelCase(result.rows));
  } catch (error) {
    console.error('Error fetching league editions:', error);
    res.status(500).json({ error: 'Failed to fetch league editions' });
  }
};

const getTournamentEditionById = async (req, res) => {
  try {
    const result = await query(
      `SELECT te.*, l.name as league_name, l.league_type, l.description as league_description
       FROM tournament_editions te
       JOIN leagues l ON te.league_id = l.id
       WHERE te.id = $1`,
      [req.params.editionId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament edition not found' });
    }
    
    res.json(toCamelCase(result.rows[0]));
  } catch (error) {
    console.error('Error fetching tournament edition:', error);
    res.status(500).json({ error: 'Failed to fetch tournament edition' });
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
    
    // If no league is associated, assignment is valid
    if (!tournament.league_id) {
      return res.json(toCamelCase(validation));
    }
    
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
             te.id as edition_id, te.name as edition_name, te.year, te.season,
             t.id as team_id, t.name as team_name, tp.role, tp.joined_date, tp.left_date,
             tournament.id as tournament_id, tournament.name as tournament_name,
             tournament.status as tournament_status
      FROM team_players tp
      JOIN teams t ON tp.team_id = t.id
      JOIN tournaments tournament ON tp.tournament_id = tournament.id
      LEFT JOIN tournament_editions te ON tournament.edition_id = te.id
      LEFT JOIN leagues l ON tournament.league_id = l.id
      WHERE tp.player_id = $1`;
    
    const queryParams = [req.params.playerId];
    
    if (!includeInactive || includeInactive === 'false') {
      queryText += ' AND tp.is_active = true';
    }
    
    queryText += ' ORDER BY te.year DESC, te.edition_number DESC, tp.joined_date DESC';
    
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
             te.name as edition_name, p.name as player_name
      FROM team_league_violations tlv
      JOIN teams t ON tlv.team_id = t.id
      JOIN leagues l ON tlv.league_id = l.id
      LEFT JOIN tournament_editions te ON tlv.edition_id = te.id
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
  // Tournament edition management
  createTournamentEdition,
  getLeagueEditions,
  getTournamentEditionById,
  // Validation and eligibility
  validatePlayerTeamAssignment,
  getPlayerLeagueHistory,
  getLeagueViolations
};