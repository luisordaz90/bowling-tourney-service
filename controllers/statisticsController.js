// controllers/statisticsController.js
const { query } = require('../config/database');
const logger = require('../config/logger');

const getStandings = async (req, res) => {
  try {
    const tournamentResult = await query(
      'SELECT id, ranking_method FROM tournaments WHERE id = $1',
      [req.params.tournamentId]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const { ranking_method } = tournamentResult.rows[0];

    // pins-based standings: aggregate scores (open format) by player, rank by total pins with hdcp
    if (ranking_method === 'pins') {
      const result = await query(
        `SELECT
           p.id                                                        AS player_id,
           p.name                                                      AS player_name,
           s.team_id,
           t.name                                                      AS team_name,
           COUNT(DISTINCT s.session_id)                                AS sessions_played,
           SUM(s.pins_with_hdcp)                                       AS total_pins,
           ROUND(SUM(s.score)::DECIMAL / COUNT(*), 2)                  AS tournament_average,
           RANK() OVER (ORDER BY SUM(s.pins_with_hdcp) DESC)           AS current_rank
         FROM   scores s
         JOIN   players p ON s.player_id = p.id
         LEFT JOIN teams t ON s.team_id  = t.id
         WHERE  s.tournament_id = $1
           AND  s.match_id IS NULL
         GROUP BY p.id, p.name, s.team_id, t.name
         ORDER BY current_rank`,
        [req.params.tournamentId]
      );

      return res.json(result.rows.map(row => ({
        playerId: row.player_id,
        playerName: row.player_name,
        teamId: row.team_id,
        teamName: row.team_name,
        sessionsPlayed: parseInt(row.sessions_played),
        totalPins: parseInt(row.total_pins),
        tournamentAverage: parseFloat(row.tournament_average),
        rank: parseInt(row.current_rank)
      })));
    }

    // points-based standings: use existing tournament_standings view
    const result = await query(
      `SELECT * FROM tournament_standings
       WHERE tournament_id = $1
       ORDER BY current_rank`,
      [req.params.tournamentId]
    );

    return res.json(result.rows.map(row => ({
      teamId: row.team_id,
      teamName: row.team_name,
      captainName: row.captain_name,
      totalScore: parseInt(row.total_score),
      gamesPlayed: parseInt(row.matches_played) * 3,
      averageScore: parseFloat(row.team_average),
      matchesPlayed: parseInt(row.matches_played),
      matchesWon: parseInt(row.matches_won),
      matchesLost: parseInt(row.matches_lost),
      winPercentage: parseFloat(row.win_percentage),
      totalPoints: parseInt(row.total_points),
      pointsPercentage: parseFloat(row.points_percentage),
      maxPossiblePoints: parseInt(row.matches_played) * 4,
      seedNumber: row.seed_number,
      status: row.status,
      rank: parseInt(row.current_rank)
    })));
  } catch (error) {
    logger.error('Error fetching standings:', error);
    res.status(500).json({ error: 'Failed to get standings' });
  }
};

const getStatistics = async (req, res) => {
  try {
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const statsResult = await query(
      `SELECT
        (SELECT COUNT(*)   FROM tournament_teams WHERE tournament_id = $1) AS total_teams,
        (SELECT COUNT(*) FROM team_players tp
         JOIN tournament_teams tt ON tp.team_id = tt.team_id AND tp.tournament_id = tt.tournament_id
         WHERE tp.tournament_id = $1 AND tp.is_active = true) AS total_players,
        (SELECT COUNT(*)   FROM scores WHERE tournament_id = $1) AS total_games,
        (SELECT COALESCE(MAX(score), 0) FROM scores WHERE tournament_id = $1) AS highest_game,
        (SELECT COALESCE(MAX(series_total), 0) FROM (
           SELECT SUM(score) AS series_total
           FROM scores WHERE tournament_id = $1
           GROUP BY COALESCE(match_id::TEXT, session_id::TEXT || player_id::TEXT)
         ) series_agg) AS highest_series,
        (SELECT COALESCE(ROUND(AVG(score)), 0) FROM scores WHERE tournament_id = $1) AS average_score,
        (SELECT sessions_completed FROM tournaments WHERE id = $1) AS sessions_completed,
        (SELECT total_sessions     FROM tournaments WHERE id = $1) AS total_sessions,
        (SELECT COUNT(*) FROM matches WHERE tournament_id = $1) AS total_matches,
        (SELECT COUNT(*) FROM matches WHERE tournament_id = $1 AND status = 'completed') AS completed_matches,
        (SELECT COUNT(*) FROM matches WHERE tournament_id = $1 AND status = 'scheduled') AS scheduled_matches,
        (SELECT COALESCE(SUM(total_points), 0) FROM team_statistics WHERE tournament_id = $1) AS total_points_awarded,
        (SELECT COUNT(*) * 4 FROM matches WHERE tournament_id = $1 AND status = 'completed') AS max_possible_points,
        (SELECT COALESCE(ROUND(AVG(total_points::DECIMAL), 2), 0) FROM team_statistics WHERE tournament_id = $1) AS average_points_per_team,
        (SELECT COALESCE(ROUND(AVG(points_percentage)), 0) FROM team_statistics WHERE tournament_id = $1) AS average_points_percentage`,
      [req.params.tournamentId]
    );

    const stats = statsResult.rows[0];

    res.json({
      totalTeams: parseInt(stats.total_teams),
      totalPlayers: parseInt(stats.total_players),
      totalGames: parseInt(stats.total_games),
      highestGame: parseInt(stats.highest_game),
      highestSeries: parseInt(stats.highest_series),
      averageScore: parseInt(stats.average_score),
      sessionsCompleted: parseInt(stats.sessions_completed),
      totalSessions: parseInt(stats.total_sessions),
      totalMatches: parseInt(stats.total_matches),
      completedMatches: parseInt(stats.completed_matches),
      scheduledMatches: parseInt(stats.scheduled_matches),
      pointSystem: {
        totalPointsAwarded: parseInt(stats.total_points_awarded),
        maxPossiblePoints: parseInt(stats.max_possible_points),
        averagePointsPerTeam: parseFloat(stats.average_points_per_team),
        averagePointsPercentage: parseFloat(stats.average_points_percentage)
      }
    });
  } catch (error) {
    logger.error('Error fetching statistics:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
};

const getPlayerTournamentStatistics = async (req, res) => {
  try {
    const { tournamentId, playerId } = req.params;

    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);
    const playerResult     = await query('SELECT id FROM players WHERE id = $1', [playerId]);

    if (tournamentResult.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });
    if (playerResult.rows.length === 0)     return res.status(404).json({ error: 'Player not found' });

    const statsResult = await query(
      `SELECT
         COUNT(DISTINCT s.match_id) FILTER (WHERE s.match_id IS NOT NULL)  AS matches_played,
         COUNT(*)                                                            AS games_played,
         COALESCE(SUM(s.score), 0)                                          AS total_pins,
         CASE WHEN COUNT(*) > 0
              THEN ROUND(SUM(s.score)::DECIMAL / COUNT(*), 2)
              ELSE 0 END                                                     AS current_average,
         COALESCE(MAX(s.score), 0)                                          AS highest_game,
         COALESCE((
           SELECT MAX(series_total) FROM (
             SELECT SUM(s2.score) AS series_total
             FROM scores s2
             WHERE s2.player_id = $1 AND s2.tournament_id = $2
             GROUP BY COALESCE(s2.match_id::TEXT, s2.session_id::TEXT)
           ) sa
         ), 0)                                                               AS highest_series,
         COALESCE(COUNT(DISTINCT CASE WHEN EXISTS (
           SELECT 1 FROM match_points mp
           WHERE mp.match_id = s.match_id
             AND ((mp.home_team_id = s.team_id AND mp.home_total_points > mp.away_total_points)
                  OR (mp.away_team_id = s.team_id AND mp.away_total_points > mp.home_total_points))
         ) THEN s.match_id END), 0)                                         AS matches_contributed_to_win
       FROM scores s
       WHERE s.player_id = $1 AND s.tournament_id = $2`,
      [playerId, tournamentId]
    );

    const stats = statsResult.rows[0];

    const hdcpResult = await query(
      'SELECT current_handicap FROM player_statistics WHERE player_id = $1 AND tournament_id = $2',
      [playerId, tournamentId]
    );
    const currentHandicap = hdcpResult.rows.length > 0
      ? parseInt(hdcpResult.rows[0].current_handicap)
      : 0;

    res.json({
      playerId,
      tournamentId,
      gamesPlayed: parseInt(stats.games_played),
      totalPins: parseInt(stats.total_pins),
      currentAverage: parseFloat(stats.current_average),
      highestGame: parseInt(stats.highest_game),
      highestSeries: parseInt(stats.highest_series),
      matchesPlayed: parseInt(stats.matches_played),
      matchesContributedToWin: parseInt(stats.matches_contributed_to_win),
      currentHandicap
    });
  } catch (error) {
    logger.error('Error fetching player statistics:', error);
    res.status(500).json({ error: 'Failed to get player statistics' });
  }
};

const getTeamTournamentStatistics = async (req, res) => {
  try {
    const { tournamentId, teamId } = req.params;

    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);
    const teamResult       = await query('SELECT id FROM teams WHERE id = $1', [teamId]);

    if (tournamentResult.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });
    if (teamResult.rows.length === 0)       return res.status(404).json({ error: 'Team not found' });

    const statsResult = await query(
      `SELECT
         ts.*,
         (SELECT current_rank FROM tournament_standings
          WHERE tournament_id = $1 AND team_id = $2) AS rank_position,
         COALESCE(SUM(
           CASE WHEN mp.home_team_id = $2
                THEN (SELECT COALESCE(SUM(val::int), 0) FROM jsonb_array_elements_text(mp.home_game_points) AS t(val))
                ELSE (SELECT COALESCE(SUM(val::int), 0) FROM jsonb_array_elements_text(mp.away_game_points) AS t(val))
           END
         ), 0) AS total_game_points_won,
         COALESCE(SUM(
           CASE WHEN mp.home_team_id = $2 THEN mp.home_series_points ELSE mp.away_series_points END
         ), 0) AS series_points_won
       FROM team_statistics ts
       LEFT JOIN matches m ON (m.home_team_id = $2 OR m.away_team_id = $2) AND m.tournament_id = $1
       LEFT JOIN match_points mp ON m.id = mp.match_id
       WHERE ts.team_id = $2 AND ts.tournament_id = $1
       GROUP BY ts.id, ts.team_id, ts.tournament_id, ts.total_matches_played, ts.matches_won,
                ts.matches_lost, ts.total_team_score, ts.team_average, ts.total_points,
                ts.points_percentage, ts.rank_position, ts.last_updated`,
      [tournamentId, teamId]
    );

    if (statsResult.rows.length === 0) {
      return res.json({
        teamId, tournamentId,
        totalMatchesPlayed: 0, matchesWon: 0, matchesLost: 0,
        totalTeamScore: 0, teamAverage: 0, totalPoints: 0,
        pointsPercentage: 0, maxPossiblePoints: 0, rankPosition: null,
        pointsBreakdown: { totalGamePointsWon: 0, seriesPointsWon: 0 }
      });
    }

    const stats = statsResult.rows[0];

    res.json({
      teamId, tournamentId,
      totalMatchesPlayed: parseInt(stats.total_matches_played),
      matchesWon: parseInt(stats.matches_won),
      matchesLost: parseInt(stats.matches_lost),
      totalTeamScore: parseInt(stats.total_team_score),
      teamAverage: parseFloat(stats.team_average),
      totalPoints: parseInt(stats.total_points),
      pointsPercentage: parseFloat(stats.points_percentage),
      maxPossiblePoints: parseInt(stats.total_matches_played) * 4,
      rankPosition: stats.rank_position ? parseInt(stats.rank_position) : null,
      pointsBreakdown: {
        totalGamePointsWon: parseInt(stats.total_game_points_won),
        seriesPointsWon: parseInt(stats.series_points_won)
      }
    });
  } catch (error) {
    logger.error('Error fetching team statistics:', error);
    res.status(500).json({ error: 'Failed to get team statistics' });
  }
};

const getTournamentPlayersStatistics = async (req, res) => {
  try {
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const result = await query(
      `SELECT pp.*,
              COALESCE(COUNT(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM match_points mp
                WHERE mp.match_id = s.match_id
                  AND ((mp.home_team_id = pp.team_id AND mp.home_total_points > mp.away_total_points)
                       OR (mp.away_team_id = pp.team_id AND mp.away_total_points > mp.home_total_points))
              ) THEN s.match_id END), 0) AS matches_contributed_to_win
       FROM player_performance pp
       LEFT JOIN scores s ON pp.player_id = s.player_id AND pp.tournament_id = s.tournament_id
                          AND s.match_id IS NOT NULL
       WHERE pp.tournament_id = $1
       GROUP BY pp.player_id, pp.player_name, pp.team_id, pp.tournament_id,
                pp.games_played, pp.total_pins, pp.current_average,
                pp.highest_game, pp.highest_series, pp.matches_played,
                pp.tournament_name, pp.team_name
       ORDER BY pp.current_average DESC, pp.total_pins DESC`,
      [req.params.tournamentId]
    );

    res.json(result.rows.map(row => ({
      playerId: row.player_id,
      playerName: row.player_name,
      teamId: row.team_id,
      tournamentId: row.tournament_id,
      gamesPlayed: parseInt(row.games_played),
      totalPins: parseInt(row.total_pins),
      currentAverage: parseFloat(row.current_average),
      highestGame: parseInt(row.highest_game),
      highestSeries: parseInt(row.highest_series),
      matchesPlayed: parseInt(row.matches_played),
      matchesContributedToWin: parseInt(row.matches_contributed_to_win || 0)
    })));
  } catch (error) {
    logger.error('Error fetching tournament player statistics:', error);
    res.status(500).json({ error: 'Failed to get player statistics' });
  }
};

const getTournamentTeamsStatistics = async (req, res) => {
  try {
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const result = await query(
      `SELECT
         team_id, team_name, tournament_id,
         matches_played AS total_matches_played,
         matches_won, matches_lost,
         total_score AS total_team_score,
         team_average, total_points, points_percentage,
         current_rank AS rank_position
       FROM tournament_standings
       WHERE tournament_id = $1
       ORDER BY current_rank`,
      [req.params.tournamentId]
    );

    res.json(result.rows.map(row => ({
      teamId: row.team_id,
      teamName: row.team_name,
      tournamentId: row.tournament_id,
      totalMatchesPlayed: parseInt(row.total_matches_played),
      matchesWon: parseInt(row.matches_won),
      matchesLost: parseInt(row.matches_lost),
      totalTeamScore: parseInt(row.total_team_score),
      teamAverage: parseFloat(row.team_average),
      totalPoints: parseInt(row.total_points),
      pointsPercentage: parseFloat(row.points_percentage),
      maxPossiblePoints: parseInt(row.total_matches_played) * 4,
      rankPosition: parseInt(row.rank_position)
    })));
  } catch (error) {
    logger.error('Error fetching tournament team statistics:', error);
    res.status(500).json({ error: 'Failed to get team statistics' });
  }
};

const updatePlayerStatistics = async (req, res) => {
  try {
    const { playerId, tournamentId } = req.params;
    const { teamId, gamesPlayed, totalPins, currentAverage, highestGame, highestSeries, matchesPlayed } = req.body;

    const playerResult     = await query('SELECT id FROM players WHERE id = $1', [playerId]);
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);

    if (playerResult.rows.length === 0)     return res.status(404).json({ error: 'Player not found' });
    if (tournamentResult.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });

    const result = await query(
      `INSERT INTO player_statistics
         (player_id, tournament_id, team_id, games_played, total_pins, current_average,
          highest_game, highest_series, matches_played)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (player_id, tournament_id, team_id) DO UPDATE SET
         games_played    = EXCLUDED.games_played,
         total_pins      = EXCLUDED.total_pins,
         current_average = EXCLUDED.current_average,
         highest_game    = EXCLUDED.highest_game,
         highest_series  = EXCLUDED.highest_series,
         matches_played  = EXCLUDED.matches_played,
         last_updated    = CURRENT_TIMESTAMP
       RETURNING *`,
      [playerId, tournamentId, teamId || null,
       gamesPlayed || 0, totalPins || 0, currentAverage || 0,
       highestGame || 0, highestSeries || 0, matchesPlayed || 0]
    );

    return res.status(result.rows.length === 0 ? 201 : 200).json(result.rows[0]);
  } catch (error) {
    logger.error('Error updating player statistics:', error);
    res.status(500).json({ error: 'Failed to update player statistics' });
  }
};

const updateTeamStatistics = async (req, res) => {
  try {
    const { teamId, tournamentId } = req.params;
    const { totalMatchesPlayed, matchesWon, matchesLost, totalTeamScore, teamAverage,
            totalPoints, pointsPercentage, rankPosition } = req.body;

    const teamResult       = await query('SELECT id FROM teams WHERE id = $1', [teamId]);
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);

    if (teamResult.rows.length === 0)       return res.status(404).json({ error: 'Team not found' });
    if (tournamentResult.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });

    const result = await query(
      `INSERT INTO team_statistics
         (team_id, tournament_id, total_matches_played, matches_won, matches_lost,
          total_team_score, team_average, total_points, points_percentage, rank_position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (team_id, tournament_id) DO UPDATE SET
         total_matches_played = EXCLUDED.total_matches_played,
         matches_won          = EXCLUDED.matches_won,
         matches_lost         = EXCLUDED.matches_lost,
         total_team_score     = EXCLUDED.total_team_score,
         team_average         = EXCLUDED.team_average,
         total_points         = EXCLUDED.total_points,
         points_percentage    = EXCLUDED.points_percentage,
         rank_position        = EXCLUDED.rank_position,
         last_updated         = CURRENT_TIMESTAMP
       RETURNING *`,
      [teamId, tournamentId,
       totalMatchesPlayed || 0, matchesWon || 0, matchesLost || 0,
       totalTeamScore || 0, teamAverage || 0, totalPoints || 0,
       pointsPercentage || 0, rankPosition || null]
    );

    return res.status(result.rows.length === 0 ? 201 : 200).json(result.rows[0]);
  } catch (error) {
    logger.error('Error updating team statistics:', error);
    res.status(500).json({ error: 'Failed to update team statistics' });
  }
};

module.exports = {
  getStandings,
  getStatistics,
  getPlayerTournamentStatistics,
  getTeamTournamentStatistics,
  getTournamentPlayersStatistics,
  getTournamentTeamsStatistics,
  updatePlayerStatistics,
  updateTeamStatistics
};
