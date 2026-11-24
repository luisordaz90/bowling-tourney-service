// controllers/teamController.js
const { query, withTransaction } = require('../config/database');
const logger = require('../config/logger');

const createTeam = async (req, res) => {
  try {
    const { name, captainName, captainEmail, captainPhone } = req.body;
    
    if (!name || !captainName || !captainEmail) {
      return res.status(400).json({ error: 'Team name, captain name, and captain email are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(captainEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const result = await query(
      `INSERT INTO teams (name, captain_name, captain_email, captain_phone)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, captainName, captainEmail, captainPhone || null]
    );

    res.status(201).json((result.rows[0]));
  } catch (error) {
    logger.error('Error creating team:', error);
    
    // Handle unique constraint violations
    if (error.code === '23505') {
      if (error.constraint === 'teams_name_key') {
        return res.status(400).json({ error: 'Team name already exists' });
      }
    }
    
    res.status(500).json({ error: 'Failed to create team' });
  }
};

const getTeams = async (req, res) => {
  try {
    const result = await query('SELECT * FROM teams ORDER BY name');
    res.json((result.rows));
  } catch (error) {
    logger.error('Error fetching teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
};

const getTeamById = async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const result = await query('SELECT * FROM teams WHERE id = $1', [teamId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const team = result.rows[0];

    // Roster: active players across all tournaments
    const rosterResult = await query(
      `SELECT DISTINCT ON (p.id) p.id AS player_id, p.name, p.email,
              tp.role, tp.is_active, tp.joined_date
       FROM team_players tp
       JOIN players p ON tp.player_id = p.id
       WHERE tp.team_id = $1 AND tp.is_active = true
       ORDER BY p.id, tp.joined_date DESC`,
      [teamId]
    );

    // Tournament/league enrollments
    const tournamentsResult = await query(
      `SELECT t.id AS tournament_id, t.name AS tournament_name, t.status AS tournament_status,
              t.start_date, t.end_date,
              l.id AS league_id, l.name AS league_name
       FROM tournament_teams tt
       JOIN tournaments t ON tt.tournament_id = t.id
       JOIN leagues l ON t.league_id = l.id
       WHERE tt.team_id = $1
       ORDER BY t.start_date DESC`,
      [teamId]
    );

    res.json({
      ...team,
      roster: rosterResult.rows.map(r => ({
        playerId: r.player_id,
        name: r.name,
        email: r.email,
        role: r.role,
        isActive: r.is_active,
        joinedDate: r.joined_date,
      })),
      tournaments: tournamentsResult.rows.map(r => ({
        tournamentId: r.tournament_id,
        tournamentName: r.tournament_name,
        tournamentStatus: r.tournament_status,
        startDate: r.start_date,
        endDate: r.end_date,
        leagueId: r.league_id,
        leagueName: r.league_name,
      })),
    });
  } catch (error) {
    logger.error('Error fetching team:', error);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
};

const updateTeam = async (req, res) => {
  try {
    const { name, captainName, captainEmail, captainPhone, status } = req.body;

    // Validate email format if provided
    if (captainEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(captainEmail)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    // Validate status if provided
    if (status && !['active', 'inactive', 'withdrawn'].includes(status)) {
      return res.status(400).json({ error: 'Invalid team status' });
    }

    const updateFields = [];
    const updateValues = [];
    let paramCounter = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCounter++}`);
      updateValues.push(name);
    }
    if (captainName !== undefined) {
      updateFields.push(`captain_name = $${paramCounter++}`);
      updateValues.push(captainName);
    }
    if (captainEmail !== undefined) {
      updateFields.push(`captain_email = $${paramCounter++}`);
      updateValues.push(captainEmail);
    }
    if (captainPhone !== undefined) {
      updateFields.push(`captain_phone = $${paramCounter++}`);
      updateValues.push(captainPhone);
    }
    if (status !== undefined) {
      updateFields.push(`status = $${paramCounter++}`);
      updateValues.push(status);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(req.params.teamId);

    const result = await query(
      `UPDATE teams SET ${updateFields.join(', ')} WHERE id = $${paramCounter} RETURNING *`,
      updateValues
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }

    res.json((result.rows[0]));
  } catch (error) {
    logger.error('Error updating team:', error);
    
    // Handle unique constraint violations
    if (error.code === '23505') {
      if (error.constraint === 'teams_name_key') {
        return res.status(400).json({ error: 'Team name already exists' });
      }
    }
    
    res.status(500).json({ error: 'Failed to update team' });
  }
};

const deleteTeam = async (req, res) => {
  try {
    await withTransaction(async (client) => {
      // Check if team exists
      const teamResult = await client.query('SELECT id FROM teams WHERE id = $1', [req.params.teamId]);
      if (teamResult.rows.length === 0) {
        throw new Error('Team not found');
      }

      // Check if team is registered in any tournaments
      const tournamentResult = await client.query(
        'SELECT COUNT(*) FROM tournament_teams WHERE team_id = $1',
        [req.params.teamId]
      );
      
      if (parseInt(tournamentResult.rows[0].count) > 0) {
        throw new Error('Cannot delete team that is registered in tournaments. Please withdraw from tournaments first.');
      }

      // Delete the team (cascade will handle related records)
      await client.query('DELETE FROM teams WHERE id = $1', [req.params.teamId]);
    });

    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting team:', error);
    
    if (error.message === 'Team not found') {
      return res.status(404).json({ error: error.message });
    }
    
    if (error.message.includes('Cannot delete team that is registered in tournaments')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to delete team' });
  }
};

module.exports = {
  createTeam,
  getTeams,
  getTeamById,
  updateTeam,
  deleteTeam
};