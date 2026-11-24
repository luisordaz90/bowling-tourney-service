// controllers/registrationsController.js
// Flat registration endpoints — IDs come from body/query instead of nested URL params.
const { query, withTransaction } = require('../config/database');
const { toCamelCase } = require('../utils/helpers');

const registerTeam = async (req, res) => {
  try {
    const { tournamentId, teamId, seedNumber } = req.body;

    if (!tournamentId || !teamId) {
      return res.status(400).json({ error: 'tournamentId and teamId are required' });
    }

    await withTransaction(async (client) => {
      const tournamentResult = await client.query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
      if (tournamentResult.rows.length === 0) throw new Error('Tournament not found');
      const tournament = tournamentResult.rows[0];

      const teamResult = await client.query('SELECT * FROM teams WHERE id = $1', [teamId]);
      if (teamResult.rows.length === 0) throw new Error('Team not found');

      const teamCountResult = await client.query(
        'SELECT COUNT(*) FROM tournament_teams WHERE tournament_id = $1', [tournamentId]
      );
      if (parseInt(teamCountResult.rows[0].count) >= tournament.max_teams) throw new Error('Tournament is full');

      const existingResult = await client.query(
        'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2', [tournamentId, teamId]
      );
      if (existingResult.rows.length > 0) throw new Error('Team is already registered for this tournament');

      const result = await client.query(
        `INSERT INTO tournament_teams (tournament_id, team_id, seed_number)
         VALUES ($1, $2, $3) RETURNING *`,
        [tournamentId, teamId, seedNumber || null]
      );

      res.status(201).json(toCamelCase(result.rows[0]));
    });
  } catch (error) {
    if (['Tournament not found', 'Team not found', 'Tournament is full', 'Team is already registered for this tournament'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to register team' });
  }
};

const getRegisteredTeams = async (req, res) => {
  try {
    const { tournamentId } = req.query;
    if (!tournamentId) return res.status(400).json({ error: 'tournamentId query param is required' });

    const result = await query(
      `SELECT tt.*, t.name, t.captain_name, t.captain_email, t.captain_phone, t.status as team_status
       FROM tournament_teams tt
       JOIN teams t ON tt.team_id = t.id
       WHERE tt.tournament_id = $1
       ORDER BY tt.seed_number NULLS LAST, t.name`,
      [tournamentId]
    );

    const teams = result.rows.map(row => ({
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

    res.json(teams);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch registered teams' });
  }
};

const unregisterTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { tournamentId } = req.query;
    if (!tournamentId) return res.status(400).json({ error: 'tournamentId query param is required' });

    const existing = await query(
      'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
      [tournamentId, teamId]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Team is not registered in this tournament' });

    await query('DELETE FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2', [tournamentId, teamId]);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to unregister team' });
  }
};

const registerPlayer = async (req, res) => {
  try {
    const { tournamentId, teamId, playerId, role } = req.body;

    if (!tournamentId || !teamId || !playerId) {
      return res.status(400).json({ error: 'tournamentId, teamId, and playerId are required' });
    }

    const validRoles = ['captain', 'regular', 'substitute'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid player role' });
    }

    await withTransaction(async (client) => {
      const tournamentResult = await client.query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);
      if (tournamentResult.rows.length === 0) throw new Error('Tournament not found');

      const teamResult = await client.query('SELECT id FROM teams WHERE id = $1', [teamId]);
      if (teamResult.rows.length === 0) throw new Error('Team not found');

      const playerResult = await client.query('SELECT id FROM players WHERE id = $1', [playerId]);
      if (playerResult.rows.length === 0) throw new Error('Player not found');

      const teamTournamentResult = await client.query(
        'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2', [tournamentId, teamId]
      );
      if (teamTournamentResult.rows.length === 0) throw new Error('Team is not registered in this tournament');

      const existingResult = await client.query(
        'SELECT id FROM team_players WHERE tournament_id = $1 AND team_id = $2 AND player_id = $3',
        [tournamentId, teamId, playerId]
      );
      if (existingResult.rows.length > 0) throw new Error('Player is already assigned to this team in this tournament');

      const result = await client.query(
        `INSERT INTO team_players (team_id, player_id, tournament_id, role)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [teamId, playerId, tournamentId, role || 'regular']
      );

      res.status(201).json(toCamelCase(result.rows[0]));
    });
  } catch (error) {
    if (['Tournament not found', 'Team not found', 'Player not found', 'Team is not registered in this tournament', 'Player is already assigned to this team in this tournament'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to register player' });
  }
};

const getRegisteredPlayers = async (req, res) => {
  try {
    const { tournamentId, teamId } = req.query;
    if (!tournamentId || !teamId) return res.status(400).json({ error: 'tournamentId and teamId query params are required' });

    const result = await query(
      `SELECT tp.*, p.name, p.email, p.phone
       FROM team_players tp
       JOIN players p ON tp.player_id = p.id
       WHERE tp.tournament_id = $1 AND tp.team_id = $2 AND tp.is_active = true
       ORDER BY tp.role, p.name`,
      [tournamentId, teamId]
    );

    const players = result.rows.map(row => ({
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
      }
    }));

    res.json(players);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch registered players' });
  }
};

const removePlayer = async (req, res) => {
  try {
    const { playerId } = req.params;
    const { tournamentId, teamId } = req.query;
    if (!tournamentId || !teamId) return res.status(400).json({ error: 'tournamentId and teamId query params are required' });

    const existing = await query(
      'SELECT id FROM team_players WHERE tournament_id = $1 AND team_id = $2 AND player_id = $3 AND is_active = true',
      [tournamentId, teamId, playerId]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Player is not on this team roster' });

    await query(
      'UPDATE team_players SET is_active = false, left_date = NOW() WHERE tournament_id = $1 AND team_id = $2 AND player_id = $3',
      [tournamentId, teamId, playerId]
    );

    res.json({ message: 'Player removed from roster' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove player' });
  }
};

module.exports = {
  registerTeam,
  getRegisteredTeams,
  unregisterTeam,
  registerPlayer,
  getRegisteredPlayers,
  removePlayer
};
