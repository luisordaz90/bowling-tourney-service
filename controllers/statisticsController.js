// controllers/statisticsController.js - Updated with Point System
const { query } = require('../config/database');
const logger = require('../config/logger');

const getStandings = async (req, res) => {
  try {
    // Use the updated tournament_standings view with points
    const result = await query(
      `SELECT * FROM tournament_standings 
       WHERE tournament_id = $1 
       ORDER BY current_rank`,
      [req.params.tournamentId]
    );

    if (result.rows.length === 0) {
      // Check if tournament exists
      const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
      if (tournamentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Tournament not found' });
      }
    }

    // Transform the data to match the expected API format with new point system
    const standings = result.rows.map(row => ({
      teamId: row.team_id,
      teamName: row.team_name,
      captainName: row.captain_name,
      totalScore: parseInt(row.total_score),
      gamesPlayed: parseInt(row.matches_played) * 3, // Assuming 3 games per match
      averageScore: parseFloat(row.team_average),
      matchesPlayed: parseInt(row.matches_played),
      matchesWon: parseInt(row.matches_won),
      matchesLost: parseInt(row.matches_lost),
      winPercentage: parseFloat(row.win_percentage),
      // New point system fields
      totalPoints: parseInt(row.total_points),
      pointsPercentage: parseFloat(row.points_percentage),
      maxPossiblePoints: parseInt(row.matches_played) * 4,
      seedNumber: row.seed_number,
      status: row.status,
      rank: parseInt(row.current_rank)
    }));

    res.json((standings));
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

    // Get comprehensive tournament statistics including point system data
    const statsResult = await query(
      `SELECT 
        (SELECT COUNT(*) FROM tournament_teams WHERE tournament_id = $1) as total_teams,
        (SELECT COUNT(*) FROM team_players tp 
         JOIN tournament_teams tt ON tp.team_id = tt.team_id AND tp.tournament_id = tt.tournament_id
         WHERE tp.tournament_id = $1 AND tp.is_active = true) as total_players,
        (SELECT COUNT(*) * 3 FROM player_match_scores pms 
         JOIN matches m ON pms.match_id = m.id 
         WHERE m.tournament_id = $1) as total_games,
        (SELECT COALESCE(MAX(GREATEST(game1_score, game2_score, game3_score)), 0) 
         FROM player_match_scores pms 
         JOIN matches m ON pms.match_id = m.id 
         WHERE m.tournament_id = $1) as highest_game,
        (SELECT COALESCE(MAX(game1_score + game2_score + game3_score), 0) 
         FROM player_match_scores pms 
         JOIN matches m ON pms.match_id = m.id 
         WHERE m.tournament_id = $1) as highest_series,
        (SELECT COALESCE(ROUND(AVG(game1_score + game2_score + game3_score) / 3), 0) 
         FROM player_match_scores pms 
         JOIN matches m ON pms.match_id = m.id 
         WHERE m.tournament_id = $1) as average_score,
        (SELECT sessions_completed FROM tournaments WHERE id = $1) as sessions_completed,
        (SELECT total_sessions FROM tournaments WHERE id = $1) as total_sessions,
        (SELECT COUNT(*) FROM matches WHERE tournament_id = $1) as total_matches,
        (SELECT COUNT(*) FROM matches WHERE tournament_id = $1 AND status = 'completed') as completed_matches,
        (SELECT COUNT(*) FROM matches WHERE tournament_id = $1 AND status = 'scheduled') as scheduled_matches,
        -- New point system statistics
        (SELECT COALESCE(SUM(total_points), 0) FROM team_statistics WHERE tournament_id = $1) as total_points_awarded,
        (SELECT COUNT(*) * 4 FROM matches WHERE tournament_id = $1 AND status = 'completed') as max_possible_points,
        (SELECT COALESCE(ROUND(AVG(total_points::DECIMAL), 2), 0) FROM team_statistics WHERE tournament_id = $1) as average_points_per_team,
        (SELECT COALESCE(ROUND(AVG(points_percentage)), 0) FROM team_statistics WHERE tournament_id = $1) as average_points_percentage`,
      [req.params.tournamentId]
    );

    const stats = statsResult.rows[0];

    const statistics = {
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
      // New point system statistics
      pointSystem: {
        totalPointsAwarded: parseInt(stats.total_points_awarded),
        maxPossiblePoints: parseInt(stats.max_possible_points),
        averagePointsPerTeam: parseFloat(stats.average_points_per_team),
        averagePointsPercentage: parseFloat(stats.average_points_percentage),
        pointsPerMatch: 4,
        gamePointsAvailable: 3, // 1 point per game
        seriesPointsAvailable: 1 // 1 point for series
      }
    };

    res.json((statistics));
  } catch (error) {
    logger.error('Error fetching statistics:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
};

const getPlayerTournamentStatistics = async (req, res) => {
  try {
    const { tournamentId, playerId } = req.params;

    // Check if tournament and player exist
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);
    const playerResult = await query('SELECT id FROM players WHERE id = $1', [playerId]);

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Get player statistics for the tournament
    const statsResult = await query(
      `SELECT 
        COUNT(pms.id) as matches_played,
        COUNT(pms.id) * 3 as games_played,
        COALESCE(SUM(pms.game1_score + pms.game2_score + pms.game3_score), 0) as total_pins,
        CASE 
          WHEN COUNT(pms.id) > 0 
          THEN ROUND(SUM(pms.game1_score + pms.game2_score + pms.game3_score)::DECIMAL / (COUNT(pms.id) * 3), 2)
          ELSE 0 
        END as current_average,
        COALESCE(MAX(GREATEST(pms.game1_score, pms.game2_score, pms.game3_score)), 0) as highest_game,
        COALESCE(MAX(pms.game1_score + pms.game2_score + pms.game3_score), 0) as highest_series,
        -- Calculate points contribution (games where player's team won points)
        COALESCE(SUM(
          CASE WHEN EXISTS (
            SELECT 1 FROM match_points mp 
            WHERE mp.match_id = pms.match_id 
            AND ((mp.home_team_id = pms.team_id AND mp.home_total_points > mp.away_total_points) 
                 OR (mp.away_team_id = pms.team_id AND mp.away_total_points > mp.home_total_points))
          ) THEN 1 ELSE 0 END
        ), 0) as matches_contributed_to_win
       FROM matches m
       LEFT JOIN player_match_scores pms ON m.id = pms.match_id AND pms.player_id = $1
       WHERE m.tournament_id = $2`,
      [playerId, tournamentId]
    );

    const stats = statsResult.rows[0];

    const statistics = {
      playerId,
      tournamentId,
      gamesPlayed: parseInt(stats.games_played),
      totalPins: parseInt(stats.total_pins),
      currentAverage: parseFloat(stats.current_average),
      highestGame: parseInt(stats.highest_game),
      highestSeries: parseInt(stats.highest_series),
      matchesPlayed: parseInt(stats.matches_played),
      matchesContributedToWin: parseInt(stats.matches_contributed_to_win)
    };

    res.json((statistics));
  } catch (error) {
    logger.error('Error fetching player statistics:', error);
    res.status(500).json({ error: 'Failed to get player statistics' });
  }
};

const getTeamTournamentStatistics = async (req, res) => {
  try {
    const { tournamentId, teamId } = req.params;

    // Check if tournament and team exist
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);
    const teamResult = await query('SELECT id FROM teams WHERE id = $1', [teamId]);

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    if (teamResult.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // Get team statistics for the tournament including point system
    const statsResult = await query(
      `SELECT 
        ts.*,
        -- Get rank position from standings
        (SELECT current_rank FROM tournament_standings 
         WHERE tournament_id = $1 AND team_id = $2) as rank_position,
        -- Point system breakdown
        COALESCE(SUM(CASE WHEN mp.home_team_id = $2 THEN mp.home_game1_points ELSE mp.away_game1_points END), 0) as game1_points_won,
        COALESCE(SUM(CASE WHEN mp.home_team_id = $2 THEN mp.home_game2_points ELSE mp.away_game2_points END), 0) as game2_points_won,
        COALESCE(SUM(CASE WHEN mp.home_team_id = $2 THEN mp.home_game3_points ELSE mp.away_game3_points END), 0) as game3_points_won,
        COALESCE(SUM(CASE WHEN mp.home_team_id = $2 THEN mp.home_series_points ELSE mp.away_series_points END), 0) as series_points_won
       FROM team_statistics ts
       LEFT JOIN matches m ON (m.home_team_id = $2 OR m.away_team_id = $2) AND m.tournament_id = $1
       LEFT JOIN match_points mp ON m.id = mp.match_id
       WHERE ts.team_id = $2 AND ts.tournament_id = $1
       GROUP BY ts.id, ts.team_id, ts.tournament_id, ts.total_matches_played, ts.matches_won, ts.matches_lost, 
                ts.total_team_score, ts.team_average, ts.total_points, ts.points_percentage, ts.rank_position, ts.last_updated`,
      [tournamentId, teamId]
    );

    if (statsResult.rows.length === 0) {
      // Return default statistics if no data exists yet
      return res.json({
        teamId,
        tournamentId,
        totalMatchesPlayed: 0,
        matchesWon: 0,
        matchesLost: 0,
        totalTeamScore: 0,
        teamAverage: 0,
        totalPoints: 0,
        pointsPercentage: 0,
        maxPossiblePoints: 0,
        rankPosition: null,
        pointsBreakdown: {
          game1PointsWon: 0,
          game2PointsWon: 0,
          game3PointsWon: 0,
          seriesPointsWon: 0
        }
      });
    }

    const stats = statsResult.rows[0];

    const statistics = {
      teamId,
      tournamentId,
      totalMatchesPlayed: parseInt(stats.total_matches_played),
      matchesWon: parseInt(stats.game1_points_won) + parseInt(stats.game2_points_won) + parseInt(stats.game3_points_won) + parseInt(stats.series_points_won),//parseInt(stats.matches_won),
      matchesLost: (parseInt(stats.total_matches_played) * 4) - (parseInt(stats.game1_points_won) + parseInt(stats.game2_points_won) + parseInt(stats.game3_points_won) + parseInt(stats.series_points_won)),//parseInt(stats.matches_lost),
      totalTeamScore: parseInt(stats.total_team_score),
      teamAverage: parseFloat(stats.team_average),
      // Point system fields
      totalPoints: parseInt(stats.total_points),
      pointsPercentage: parseFloat(stats.points_percentage),
      maxPossiblePoints: parseInt(stats.total_matches_played) * 4,
      rankPosition: stats.rank_position ? parseInt(stats.rank_position) : null,
      pointsBreakdown: {
        game1PointsWon: parseInt(stats.game1_points_won),
        game2PointsWon: parseInt(stats.game2_points_won),
        game3PointsWon: parseInt(stats.game3_points_won),
        seriesPointsWon: parseInt(stats.series_points_won)
      }
    };

    res.json((statistics));
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

    // Get all player statistics for the tournament using the player_performance view
    const result = await query(
      `SELECT pp.*,
              -- Add points contribution data
              COALESCE(SUM(
                CASE WHEN EXISTS (
                  SELECT 1 FROM match_points mp 
                  WHERE mp.match_id = pms.match_id 
                  AND ((mp.home_team_id = pp.team_id AND mp.home_total_points > mp.away_total_points) 
                       OR (mp.away_team_id = pp.team_id AND mp.away_total_points > mp.home_total_points))
                ) THEN 1 ELSE 0 END
              ), 0) as matches_contributed_to_win
       FROM player_performance pp
       LEFT JOIN player_match_scores pms ON pp.player_id = pms.player_id
       LEFT JOIN matches m ON pms.match_id = m.id AND m.tournament_id = pp.tournament_id
       WHERE pp.tournament_id = $1 
       GROUP BY pp.player_id, pp.player_name, pp.team_id, pp.tournament_id, pp.games_played, 
                pp.total_pins, pp.current_average, pp.highest_game, pp.highest_series, pp.matches_played, pp.tournament_name, pp.team_name
       ORDER BY pp.current_average DESC, pp.total_pins DESC`,
      [req.params.tournamentId]
    );

    const playerStats = result.rows.map(row => ({
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
    }));

    res.json((playerStats));
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

    // Get all team statistics for the tournament using tournament_standings view
    const result = await query(
      `SELECT 
        team_id,
        team_name,
        tournament_id,
        matches_played as total_matches_played,
        matches_won,
        matches_lost,
        total_score as total_team_score,
        team_average,
        total_points,
        points_percentage,
        current_rank as rank_position
       FROM tournament_standings 
       WHERE tournament_id = $1 
       ORDER BY current_rank`,
      [req.params.tournamentId]
    );

    const teamStats = result.rows.map(row => ({
      teamId: row.team_id,
      teamName: row.team_name,
      tournamentId: row.tournament_id,
      totalMatchesPlayed: parseInt(row.total_matches_played),
      matchesWon: parseInt(row.matches_won),
      matchesLost: parseInt(row.matches_lost),
      totalTeamScore: parseInt(row.total_team_score),
      teamAverage: parseFloat(row.team_average),
      // Point system fields
      totalPoints: parseInt(row.total_points),
      pointsPercentage: parseFloat(row.points_percentage),
      maxPossiblePoints: parseInt(row.total_matches_played) * 4,
      rankPosition: parseInt(row.rank_position)
    }));

    res.json((teamStats));
  } catch (error) {
    logger.error('Error fetching tournament team statistics:', error);
    res.status(500).json({ error: 'Failed to get team statistics' });
  }
};

const updatePlayerStatistics = async (req, res) => {
  try {
    const { playerId, tournamentId } = req.params;
    const { teamId, gamesPlayed, totalPins, currentAverage, highestGame, highestSeries, matchesPlayed } = req.body;

    // Check if player and tournament exist
    const playerResult = await query('SELECT id FROM players WHERE id = $1', [playerId]);
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);

    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Upsert player statistics
    const result = await query(
      `INSERT INTO player_statistics (player_id, tournament_id, team_id, games_played, total_pins, current_average, highest_game, highest_series, matches_played)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (player_id, tournament_id, team_id) 
       DO UPDATE SET
         games_played = EXCLUDED.games_played,
         total_pins = EXCLUDED.total_pins,
         current_average = EXCLUDED.current_average,
         highest_game = EXCLUDED.highest_game,
         highest_series = EXCLUDED.highest_series,
         matches_played = EXCLUDED.matches_played,
         last_updated = CURRENT_TIMESTAMP
       RETURNING *`,
      [playerId, tournamentId, teamId || null, gamesPlayed || 0, totalPins || 0, currentAverage || 0, highestGame || 0, highestSeries || 0, matchesPlayed || 0]
    );

    if (result.rows.length === 0) {
      return res.status(201).json((result.rows[0]));
    } else {
      return res.json((result.rows[0]));
    }
  } catch (error) {
    logger.error('Error updating player statistics:', error);
    res.status(500).json({ error: 'Failed to update player statistics' });
  }
};

const updateTeamStatistics = async (req, res) => {
  try {
    const { teamId, tournamentId } = req.params;
    const { totalMatchesPlayed, matchesWon, matchesLost, totalTeamScore, teamAverage, totalPoints, pointsPercentage, rankPosition } = req.body;

    // Check if team and tournament exist
    const teamResult = await query('SELECT id FROM teams WHERE id = $1', [teamId]);
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);

    if (teamResult.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Upsert team statistics with point system fields
    const result = await query(
      `INSERT INTO team_statistics (team_id, tournament_id, total_matches_played, matches_won, matches_lost, total_team_score, team_average, total_points, points_percentage, rank_position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (team_id, tournament_id) 
       DO UPDATE SET
         total_matches_played = EXCLUDED.total_matches_played,
         matches_won = EXCLUDED.matches_won,
         matches_lost = EXCLUDED.matches_lost,
         total_team_score = EXCLUDED.total_team_score,
         team_average = EXCLUDED.team_average,
         total_points = EXCLUDED.total_points,
         points_percentage = EXCLUDED.points_percentage,
         rank_position = EXCLUDED.rank_position,
         last_updated = CURRENT_TIMESTAMP
       RETURNING *`,
      [teamId, tournamentId, totalMatchesPlayed || 0, matchesWon || 0, matchesLost || 0, totalTeamScore || 0, teamAverage || 0, totalPoints || 0, pointsPercentage || 0, rankPosition || null]
    );

    if (result.rows.length === 0) {
      return res.status(201).json((result.rows[0]));
    } else {
      return res.json((result.rows[0]));
    }
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