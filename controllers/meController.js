// controllers/meController.js
// Endpoints that resolve the player from req.player (set by requirePlayer middleware).
// In test env (no JWT), we fall back to a X-Player-Id header for testability.
const { query } = require('../config/database');
const { toCamelCase } = require('../utils/helpers');

function resolvePlayerId(req) {
  return req.player?.id ?? req.headers['x-player-id'] ?? null;
}

const getMyTeams = async (req, res) => {
  try {
    const playerId = resolvePlayerId(req);
    if (!playerId) return res.status(401).json({ error: 'Player identity required' });

    const result = await query(
      `SELECT t.id, t.name, t.captain_name, t.status AS team_status,
              tp.role, tp.is_active, tp.joined_date, tp.left_date,
              tournament.id AS tournament_id, tournament.name AS tournament_name,
              tournament.status AS tournament_status, tournament.start_date, tournament.end_date,
              l.id AS league_id, l.name AS league_name
       FROM teams t
       JOIN team_players tp ON t.id = tp.team_id
       JOIN tournaments tournament ON tp.tournament_id = tournament.id
       JOIN leagues l ON tournament.league_id = l.id
       WHERE tp.player_id = $1 AND tp.is_active = true
       ORDER BY tournament.start_date DESC, tp.joined_date DESC`,
      [playerId]
    );

    res.json(toCamelCase(result.rows));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
};

const getMyLeagues = async (req, res) => {
  try {
    const playerId = resolvePlayerId(req);
    if (!playerId) return res.status(401).json({ error: 'Player identity required' });

    const result = await query(
      `SELECT DISTINCT l.id, l.name, l.league_type, l.status
       FROM leagues l
       JOIN tournaments t ON t.league_id = l.id
       JOIN team_players tp ON tp.tournament_id = t.id
       WHERE tp.player_id = $1 AND tp.is_active = true
       ORDER BY l.name`,
      [playerId]
    );

    res.json(toCamelCase(result.rows));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch leagues' });
  }
};

const getMyDashboard = async (req, res) => {
  try {
    const playerId = resolvePlayerId(req);
    if (!playerId) return res.status(401).json({ error: 'Player identity required' });

    // Player info
    const playerResult = await query('SELECT * FROM players WHERE id = $1', [playerId]);
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Current active teams
    const currentTeamsResult = await query(
      `SELECT DISTINCT t.id, t.name, t.captain_name, tournament.name AS tournament_name,
              tournament.id AS tournament_id, tournament.status AS tournament_status,
              tp.role, tp.joined_date, tournament.start_date
       FROM teams t
       JOIN team_players tp ON t.id = tp.team_id
       JOIN tournaments tournament ON tp.tournament_id = tournament.id
       WHERE tp.player_id = $1 AND tp.is_active = true
       ORDER BY tournament.start_date DESC`,
      [playerId]
    );

    // Overall statistics
    const overallStatsResult = await query(
      `SELECT
         COUNT(DISTINCT ps.tournament_id) AS tournaments_played,
         COALESCE(SUM(ps.games_played), 0) AS total_games,
         COALESCE(SUM(ps.total_pins), 0) AS total_pins,
         COALESCE(AVG(ps.current_average), 0) AS overall_average,
         COALESCE(MAX(ps.highest_game), 0) AS career_high_game,
         COALESCE(MAX(ps.highest_series), 0) AS career_high_series,
         COALESCE(SUM(ps.matches_played), 0) AS total_matches
       FROM player_statistics ps
       WHERE ps.player_id = $1`,
      [playerId]
    );

    // Recent scores
    const recentScoresResult = await query(
      `SELECT s.session_id, s.tournament_id, s.team_id, s.match_id,
              ls.session_name, ls.session_date,
              t.name AS tournament_name,
              ARRAY_AGG(s.score ORDER BY s.game_number) AS scores,
              SUM(s.score) AS total_pins
       FROM scores s
       JOIN tournament_sessions ls ON s.session_id = ls.id
       JOIN tournaments t ON s.tournament_id = t.id
       WHERE s.player_id = $1
       GROUP BY s.session_id, s.tournament_id, s.team_id, s.match_id,
                ls.session_name, ls.session_date, t.name
       ORDER BY ls.session_date DESC
       LIMIT 10`,
      [playerId]
    );

    res.json({
      player: toCamelCase(playerResult.rows[0]),
      currentTeams: toCamelCase(currentTeamsResult.rows),
      overallStatistics: toCamelCase(overallStatsResult.rows[0] || {}),
      recentScores: toCamelCase(recentScoresResult.rows),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
};

const getMyStatistics = async (req, res) => {
  try {
    const playerId = resolvePlayerId(req);
    if (!playerId) return res.status(401).json({ error: 'Player identity required' });

    const { tournamentId, status } = req.query;

    let queryText = `
      SELECT ps.*, t.name AS tournament_name, t.status AS tournament_status,
             t.start_date, t.end_date, t.session_type
      FROM player_statistics ps
      JOIN tournaments t ON ps.tournament_id = t.id
      WHERE ps.player_id = $1`;

    const queryParams = [playerId];
    let paramCounter = 2;

    if (tournamentId) {
      queryText += ` AND t.id = $${paramCounter++}`;
      queryParams.push(tournamentId);
    }
    if (status) {
      queryText += ` AND t.status = $${paramCounter++}`;
      queryParams.push(status);
    }

    queryText += ' ORDER BY t.start_date DESC';

    const result = await query(queryText, queryParams);
    res.json(toCamelCase(result.rows));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
};

const getMyLeagueHistory = async (req, res) => {
  try {
    const playerId = resolvePlayerId(req);
    if (!playerId) return res.status(401).json({ error: 'Player identity required' });

    const { includeInactive } = req.query;

    let queryText = `
      SELECT DISTINCT l.id AS league_id, l.name AS league_name, l.league_type,
             t.id AS team_id, t.name AS team_name, tp.role, tp.joined_date, tp.left_date,
             tournament.id AS tournament_id, tournament.name AS tournament_name,
             tournament.status AS tournament_status, tournament.year, tournament.season
      FROM team_players tp
      JOIN teams t ON tp.team_id = t.id
      JOIN tournaments tournament ON tp.tournament_id = tournament.id
      JOIN leagues l ON tournament.league_id = l.id
      WHERE tp.player_id = $1`;

    const queryParams = [playerId];

    if (!includeInactive || includeInactive === 'false') {
      queryText += ' AND tp.is_active = true';
    }

    queryText += ' ORDER BY tournament.year DESC, tp.joined_date DESC';

    const result = await query(queryText, queryParams);
    res.json(toCamelCase(result.rows));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch league history' });
  }
};

module.exports = {
  getMyTeams,
  getMyLeagues,
  getMyDashboard,
  getMyStatistics,
  getMyLeagueHistory,
};
