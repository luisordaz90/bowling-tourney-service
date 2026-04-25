// controllers/registrationController.js
// Team and player registration within tournaments.
const { query, withTransaction } = require('../config/database');
const { toCamelCase } = require('../utils/helpers');

const registerTeamToTournament = async (req, res) => {
  try {
    const { teamId, seedNumber } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    await withTransaction(async (client) => {
      // Check if tournament exists
      const tournamentResult = await client.query('SELECT * FROM tournaments WHERE id = $1', [req.params.tournamentId]);
      if (tournamentResult.rows.length === 0) {
        throw new Error('Tournament not found');
      }
      const tournament = tournamentResult.rows[0];

      // Check if team exists
      const teamResult = await client.query('SELECT * FROM teams WHERE id = $1', [teamId]);
      if (teamResult.rows.length === 0) {
        throw new Error('Team not found');
      }

      // Check if tournament is full
      const teamCountResult = await client.query(
        'SELECT COUNT(*) FROM tournament_teams WHERE tournament_id = $1',
        [req.params.tournamentId]
      );
      if (parseInt(teamCountResult.rows[0].count) >= tournament.max_teams) {
        throw new Error('Tournament is full');
      }

      // Check if team is already registered
      const existingResult = await client.query(
        'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
        [req.params.tournamentId, teamId]
      );
      if (existingResult.rows.length > 0) {
        throw new Error('Team is already registered for this tournament');
      }

      // Register team
      const result = await client.query(
        `INSERT INTO tournament_teams (tournament_id, team_id, seed_number)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [req.params.tournamentId, teamId, seedNumber || null]
      );

      res.status(201).json(toCamelCase(result.rows[0]));
    });
  } catch (error) {
    console.error('Error registering team:', error);
    if (['Tournament not found', 'Team not found', 'Tournament is full', 'Team is already registered for this tournament'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to register team for tournament' });
  }
};

const getRegisteredTeamsInTournament = async (req, res) => {
  try {
    const result = await query(
      `SELECT tt.*, t.name, t.captain_name, t.captain_email, t.captain_phone, t.status as team_status
       FROM tournament_teams tt
       JOIN teams t ON tt.team_id = t.id
       WHERE tt.tournament_id = $1
       ORDER BY tt.seed_number NULLS LAST, t.name`,
      [req.params.tournamentId]
    );

    const teamsWithDetails = result.rows.map(row => ({
      id: row.id,
      tournamentId: row.tournament_id,
      teamId: row.team_id,
      seedNumber: row.seed_number,
      totalTournamentScore: row.total_tournament_score,
      gamesPlayedInTournament: row.games_played_in_tournament,
      sessionsPlayedInTournament: row.sessions_played_in_tournament,
      registrationDate: row.registration_date,
      status: row.status,
      teamDetails: {
        id: row.team_id,
        name: row.name,
        captainName: row.captain_name,
        captainEmail: row.captain_email,
        captainPhone: row.captain_phone,
        status: row.team_status
      }
    }));

    res.json(teamsWithDetails);
  } catch (error) {
    console.error('Error fetching registered teams:', error);
    res.status(500).json({ error: 'Failed to fetch registered teams' });
  }
};

const removeTeamFromTournament = async (req, res) => {
  try {
    const { tournamentId, teamId } = req.params;

    const existing = await query(
      'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
      [tournamentId, teamId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Team is not registered in this tournament' });
    }

    await query(
      'DELETE FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
      [tournamentId, teamId]
    );

    res.json({ message: 'Team removed from tournament successfully' });
  } catch (error) {
    console.error('Error removing team from tournament:', error);
    res.status(500).json({ error: 'Failed to remove team from tournament' });
  }
};

const registerPlayerToTeamInTournament = async (req, res) => {
  try {
    const { playerId, role } = req.body;

    if (!playerId) {
      return res.status(400).json({ error: 'Player ID is required' });
    }

    // Validate role
    const validRoles = ['captain', 'regular', 'substitute'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid player role' });
    }

    await withTransaction(async (client) => {
      // Check if tournament exists
      const tournamentResult = await client.query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
      if (tournamentResult.rows.length === 0) {
        throw new Error('Tournament not found');
      }

      // Check if team exists
      const teamResult = await client.query('SELECT id FROM teams WHERE id = $1', [req.params.teamId]);
      if (teamResult.rows.length === 0) {
        throw new Error('Team not found');
      }

      // Check if player exists
      const playerResult = await client.query('SELECT id FROM players WHERE id = $1', [playerId]);
      if (playerResult.rows.length === 0) {
        throw new Error('Player not found');
      }

      // Check if team is registered in tournament
      const teamTournamentResult = await client.query(
        'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
        [req.params.tournamentId, req.params.teamId]
      );
      if (teamTournamentResult.rows.length === 0) {
        throw new Error('Team is not registered in this tournament');
      }

      // Check if player is already assigned to this team in this tournament
      const existingResult = await client.query(
        'SELECT id FROM team_players WHERE tournament_id = $1 AND team_id = $2 AND player_id = $3',
        [req.params.tournamentId, req.params.teamId, playerId]
      );
      if (existingResult.rows.length > 0) {
        throw new Error('Player is already assigned to this team in this tournament');
      }

      // Assign player to team
      const result = await client.query(
        `INSERT INTO team_players (team_id, player_id, tournament_id, role)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [req.params.teamId, playerId, req.params.tournamentId, role || 'regular']
      );

      res.status(201).json(toCamelCase(result.rows[0]));
    });
  } catch (error) {
    console.error('Error assigning player to team:', error);
    if (['Tournament not found', 'Team not found', 'Player not found', 'Team is not registered in this tournament', 'Player is already assigned to this team in this tournament'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to assign player to team' });
  }
};

const getRegisteredPlayersInRegisteredTeamInTournament = async (req, res) => {
  try {
    const result = await query(
      `SELECT tp.*, p.name, p.email, p.phone, p.handicap, p.average_score, p.total_games_played, p.total_pins
       FROM team_players tp
       JOIN players p ON tp.player_id = p.id
       WHERE tp.tournament_id = $1 AND tp.team_id = $2 AND tp.is_active = true
       ORDER BY tp.role, p.name`,
      [req.params.tournamentId, req.params.teamId]
    );

    const playersWithDetails = result.rows.map(row => ({
      id: row.id,
      teamId: row.team_id,
      playerId: row.player_id,
      tournamentId: row.tournament_id,
      role: row.role,
      isActive: row.is_active,
      joinedDate: row.joined_date,
      leftDate: row.left_date,
      playerDetails: {
        id: row.player_id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        handicap: row.handicap,
        averageScore: parseFloat(row.average_score),
        totalGamesPlayed: row.total_games_played,
        totalPins: row.total_pins
      }
    }));

    res.json(playersWithDetails);
  } catch (error) {
    console.error('Error fetching registered players:', error);
    res.status(500).json({ error: 'Failed to fetch registered players' });
  }
};

const removePlayerFromTournamentRoster = async (req, res) => {
  try {
    const { tournamentId, teamId, playerId } = req.params;

    const existing = await query(
      'SELECT id FROM team_players WHERE tournament_id = $1 AND team_id = $2 AND player_id = $3 AND is_active = true',
      [tournamentId, teamId, playerId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Player is not on this team roster in this tournament' });
    }

    await query(
      'UPDATE team_players SET is_active = false, left_date = NOW() WHERE tournament_id = $1 AND team_id = $2 AND player_id = $3',
      [tournamentId, teamId, playerId]
    );

    res.json({ message: 'Player removed from roster successfully' });
  } catch (error) {
    console.error('Error removing player from roster:', error);
    res.status(500).json({ error: 'Failed to remove player from roster' });
  }
};

module.exports = {
  registerTeamToTournament,
  getRegisteredTeamsInTournament,
  removeTeamFromTournament,
  registerPlayerToTeamInTournament,
  getRegisteredPlayersInRegisteredTeamInTournament,
  removePlayerFromTournamentRoster
};
