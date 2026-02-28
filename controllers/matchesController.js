// controllers/matchesController.js - Updated with Point System
const { query, withTransaction } = require('../config/database');
const logger = require('../config/logger');

const getMatchById = async (req, res) => {
  try {
    const result = await query(
      `SELECT m.*, ht.name as home_team_name, at.name as away_team_name, wt.name as winner_team_name,
              ls.session_name, t.name as tournament_name,
              mp.home_total_points, mp.away_total_points,
              mp.home_game1_points, mp.home_game2_points, mp.home_game3_points, mp.home_series_points,
              mp.away_game1_points, mp.away_game2_points, mp.away_game3_points, mp.away_series_points
       FROM matches m
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at ON m.away_team_id = at.id
       LEFT JOIN teams wt ON m.winner_team_id = wt.id
       LEFT JOIN league_sessions ls ON m.session_id = ls.id
       LEFT JOIN match_points mp ON m.id = mp.match_id
       JOIN tournaments t ON m.tournament_id = t.id
       WHERE m.id = $1`,
      [req.params.matchId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    const match = result.rows[0];
    const enrichedMatch = {
      ...match,
      homeTeamName: match.home_team_name,
      awayTeamName: match.away_team_name,
      winnerTeamName: match.winner_team_name,
      sessionName: match.session_name,
      tournamentName: match.tournament_name,
      pointsBreakdown: match.home_total_points !== null ? {
        homeTeam: {
          game1Points: match.home_game1_points,
          game2Points: match.home_game2_points,
          game3Points: match.home_game3_points,
          seriesPoints: match.home_series_points,
          totalPoints: match.home_total_points
        },
        awayTeam: {
          game1Points: match.away_game1_points,
          game2Points: match.away_game2_points,
          game3Points: match.away_game3_points,
          seriesPoints: match.away_series_points,
          totalPoints: match.away_total_points
        }
      } : null
    };
    
    res.json((enrichedMatch));
  } catch (error) {
    logger.error('Error fetching match:', error);
    res.status(500).json({ error: 'Failed to fetch match' });
  }
};

const updateMatchStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['scheduled', 'in_progress', 'completed', 'cancelled', 'postponed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await query(
      `UPDATE matches SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [status, req.params.matchId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    res.json((result.rows[0]));
  } catch (error) {
    logger.error('Error updating match status:', error);
    res.status(500).json({ error: 'Failed to update match status' });
  }
};

const addPlayerScoreInMatch = async (req, res) => {
  try {
    const { teamId, playerId, game1Score, game2Score, game3Score, handicapApplied } = req.body;
    
    if (!teamId || !playerId || game1Score === undefined || game2Score === undefined || game3Score === undefined) {
      return res.status(400).json({ error: 'Team ID, Player ID, and all three game scores are required' });
    }

    // Validate scores (0-300 for each game)
    const games = [game1Score, game2Score, game3Score];
    if (games.some(score => score < 0 || score > 300)) {
      return res.status(400).json({ error: 'Game scores must be between 0 and 300' });
    }

    await withTransaction(async (client) => {
      // Verify match exists
      const matchResult = await client.query('SELECT * FROM matches WHERE id = $1', [req.params.matchId]);
      if (matchResult.rows.length === 0) {
        throw new Error('Match not found');
      }
      const match = matchResult.rows[0];

      // Verify team is part of the match
      if (teamId !== match.home_team_id && teamId !== match.away_team_id) {
        throw new Error('Team is not part of this match');
      }

      // Verify player exists
      const playerResult = await client.query('SELECT id FROM players WHERE id = $1', [playerId]);
      if (playerResult.rows.length === 0) {
        throw new Error('Player not found');
      }

      // Check if score already exists for this player in this match
      const existingScoreResult = await client.query(
        'SELECT id FROM player_match_scores WHERE match_id = $1 AND player_id = $2',
        [req.params.matchId, playerId]
      );
      if (existingScoreResult.rows.length > 0) {
        throw new Error('Score already recorded for this player in this match');
      }

      // Insert player match score
      const scoreResult = await client.query(
        `INSERT INTO player_match_scores (match_id, team_id, player_id, game1_score, game2_score, game3_score, handicap_applied)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.params.matchId, teamId, playerId, game1Score, game2Score, game3Score, handicapApplied || 0]
      );

      // Update player statistics
      const totalScore = game1Score + game2Score + game3Score;
      await client.query(
        `UPDATE players 
         SET total_games_played = total_games_played + 3,
             total_pins = total_pins + $1,
             average_score = CASE 
               WHEN total_games_played + 3 > 0 
               THEN ROUND((total_pins + $1)::DECIMAL / (total_games_played + 3), 2)
               ELSE 0 
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [totalScore, playerId]
      );

      res.status(201).json((scoreResult.rows[0]));
    });
  } catch (error) {
    logger.error('Error recording player match score:', error);
    
    if (['Match not found', 'Team is not part of this match', 'Player not found', 'Score already recorded for this player in this match'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to record player match score' });
  }
};

const getPlayersMatchScore = async (req, res) => {
  try {
    const result = await query(
      `SELECT pms.*, p.name as player_name, t.name as team_name
       FROM player_match_scores pms
       JOIN players p ON pms.player_id = p.id
       JOIN teams t ON pms.team_id = t.id
       WHERE pms.match_id = $1
       ORDER BY t.name, p.name`,
      [req.params.matchId]
    );
    
    res.json((result.rows));
  } catch (error) {
    logger.error('Error fetching player match scores:', error);
    res.status(500).json({ error: 'Failed to fetch player match scores' });
  }
};

const calculateTeamScoreInMatch = async (req, res) => {
  try {
    const { teamId } = req.body;
    
    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    await withTransaction(async (client) => {
      // Verify match exists
      const matchResult = await client.query('SELECT * FROM matches WHERE id = $1', [req.params.matchId]);
      if (matchResult.rows.length === 0) {
        throw new Error('Match not found');
      }
      const match = matchResult.rows[0];

      // Verify team is part of the match
      if (teamId !== match.home_team_id && teamId !== match.away_team_id) {
        throw new Error('Team is not part of this match');
      }

      // Check if team score already exists
      const existingTeamScoreResult = await client.query(
        'SELECT id FROM team_match_scores WHERE match_id = $1 AND team_id = $2',
        [req.params.matchId, teamId]
      );
      
      let teamMatchScore;
      
      // Calculate team scores from player scores
      const playerScoresResult = await client.query(
        `SELECT game1_score + game2_score + game3_score as total_score, handicap_applied
         FROM player_match_scores 
         WHERE match_id = $1 AND team_id = $2`,
        [req.params.matchId, teamId]
      );

      if (playerScoresResult.rows.length === 0) {
        throw new Error('No player scores found for this team in this match');
      }

      const totalTeamScore = playerScoresResult.rows.reduce((sum, row) => sum + row.total_score, 0);
      const totalHandicap = playerScoresResult.rows.reduce((sum, row) => sum + row.handicap_applied, 0);
      const gamesPlayed = playerScoresResult.rows.length * 3;
      const teamAverage = parseFloat((totalTeamScore / gamesPlayed).toFixed(2));

      if (existingTeamScoreResult.rows.length > 0) {
        // Update existing team score
        const updateResult = await client.query(
          `UPDATE team_match_scores 
           SET total_team_score = $1, total_handicap = $2, team_average = $3, games_played = $4, recorded_at = CURRENT_TIMESTAMP
           WHERE match_id = $5 AND team_id = $6
           RETURNING *`,
          [totalTeamScore, totalHandicap, teamAverage, gamesPlayed, req.params.matchId, teamId]
        );
        teamMatchScore = updateResult.rows[0];
      } else {
        // Insert new team match score
        const insertResult = await client.query(
          `INSERT INTO team_match_scores (match_id, team_id, total_team_score, total_handicap, team_average, games_played)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [req.params.matchId, teamId, totalTeamScore, totalHandicap, teamAverage, gamesPlayed]
        );
        teamMatchScore = insertResult.rows[0];
      }

      // Check if both teams have scores recorded
      const bothTeamsScoresResult = await client.query(
        'SELECT COUNT(*) FROM team_match_scores WHERE match_id = $1',
        [req.params.matchId]
      );

      // If both teams have scores, calculate points and determine winner
      if (parseInt(bothTeamsScoresResult.rows[0].count) === 2) {
        // Calculate points using the database function
        const pointsResult = await client.query(
          'SELECT * FROM calculate_match_points($1)',
          [req.params.matchId]
        );
        
        if (pointsResult.rows.length > 0) {
          const points = pointsResult.rows[0];
          
          // Insert or update match points
          await client.query(
            `INSERT INTO match_points (
              match_id, home_team_id, away_team_id,
              home_game1_points, home_game2_points, home_game3_points, home_series_points, home_total_points,
              away_game1_points, away_game2_points, away_game3_points, away_series_points, away_total_points
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (match_id) DO UPDATE SET
              home_game1_points = EXCLUDED.home_game1_points,
              home_game2_points = EXCLUDED.home_game2_points,
              home_game3_points = EXCLUDED.home_game3_points,
              home_series_points = EXCLUDED.home_series_points,
              home_total_points = EXCLUDED.home_total_points,
              away_game1_points = EXCLUDED.away_game1_points,
              away_game2_points = EXCLUDED.away_game2_points,
              away_game3_points = EXCLUDED.away_game3_points,
              away_series_points = EXCLUDED.away_series_points,
              away_total_points = EXCLUDED.away_total_points,
              calculated_at = CURRENT_TIMESTAMP`,
            [
              req.params.matchId, points.home_team_id, points.away_team_id,
              points.home_g1_pts, points.home_g2_pts, points.home_g3_pts, points.home_series_pts, points.home_total_pts,
              points.away_g1_pts, points.away_g2_pts, points.away_g3_pts, points.away_series_pts, points.away_total_pts
            ]
          );

          // Determine winner based on points (most points wins)
          let winnerTeamId = null;
          if (points.home_total_pts > points.away_total_pts) {
            winnerTeamId = points.home_team_id;
          } else if (points.away_total_pts > points.home_total_pts) {
            winnerTeamId = points.away_team_id;
          }
          // If tied on points, winner remains null (tie game)

          // Update match with winner and status
          await client.query(
            `UPDATE matches 
             SET winner_team_id = $1, status = 'completed', updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [winnerTeamId, req.params.matchId]
          );

          // Update team statistics with new point system
          const homeIsWinner = winnerTeamId === points.home_team_id;
          const awayIsWinner = winnerTeamId === points.away_team_id;

          // Update home team statistics
          await client.query(
            `INSERT INTO team_statistics (team_id, tournament_id, total_matches_played, matches_won, matches_lost, total_team_score, team_average, total_points)
             VALUES ($1, $2, 1, $3, $4, $5, $6, $7)
             ON CONFLICT (team_id, tournament_id)
             DO UPDATE SET
               total_matches_played = team_statistics.total_matches_played + 1,
               matches_won = team_statistics.matches_won + $3,
               matches_lost = team_statistics.matches_lost + $4,
               total_team_score = team_statistics.total_team_score + $5,
               total_points = team_statistics.total_points + $7,
               team_average = CASE 
                 WHEN (team_statistics.total_matches_played + 1) > 0 
                 THEN ROUND((team_statistics.total_team_score + $5) / (team_statistics.total_matches_played + 1), 2)
                 ELSE 0 
               END,
               points_percentage = CASE 
                 WHEN (team_statistics.total_matches_played + 1) > 0 
                 THEN ROUND(((team_statistics.total_points + $7)::DECIMAL / ((team_statistics.total_matches_played + 1) * 4)) * 100, 2)
                 ELSE 0 
               END,
               last_updated = CURRENT_TIMESTAMP`,
            [points.home_team_id, match.tournament_id, homeIsWinner ? 1 : 0, awayIsWinner ? 1 : 0, totalTeamScore, teamAverage, points.home_total_pts]
          );

          // Update away team statistics
          const awayTeamScoreResult = await client.query(
            'SELECT total_team_score, team_average FROM team_match_scores WHERE match_id = $1 AND team_id = $2',
            [req.params.matchId, points.away_team_id]
          );
          const awayTeamScore = awayTeamScoreResult.rows[0]?.total_team_score || 0;
          const awayTeamAverage = awayTeamScoreResult.rows[0]?.team_average || 0;

          await client.query(
            `INSERT INTO team_statistics (team_id, tournament_id, total_matches_played, matches_won, matches_lost, total_team_score, team_average, total_points)
             VALUES ($1, $2, 1, $3, $4, $5, $6, $7)
             ON CONFLICT (team_id, tournament_id)
             DO UPDATE SET
               total_matches_played = team_statistics.total_matches_played + 1,
               matches_won = team_statistics.matches_won + $3,
               matches_lost = team_statistics.matches_lost + $4,
               total_team_score = team_statistics.total_team_score + $5,
               total_points = team_statistics.total_points + $7,
               team_average = CASE 
                 WHEN (team_statistics.total_matches_played + 1) > 0 
                 THEN ROUND((team_statistics.total_team_score + $5) / (team_statistics.total_matches_played + 1), 2)
                 ELSE 0 
               END,
               points_percentage = CASE 
                 WHEN (team_statistics.total_matches_played + 1) > 0 
                 THEN ROUND(((team_statistics.total_points + $7)::DECIMAL / ((team_statistics.total_matches_played + 1) * 4)) * 100, 2)
                 ELSE 0 
               END,
               last_updated = CURRENT_TIMESTAMP`,
            [points.away_team_id, match.tournament_id, awayIsWinner ? 1 : 0, homeIsWinner ? 1 : 0, awayTeamScore, awayTeamAverage, points.away_total_pts]
          );
        }
      }

      res.status(existingTeamScoreResult.rows.length > 0 ? 200 : 201).json(({
        ...teamMatchScore,
        matchCompleted: parseInt(bothTeamsScoresResult.rows[0].count) === 2,
        message: existingTeamScoreResult.rows.length > 0 ? 'Team score updated successfully' : 'Team score calculated successfully'
      }));
    });
  } catch (error) {
    logger.error('Error calculating team match score:', error);
    
    if (['Match not found', 'Team is not part of this match', 'No player scores found for this team in this match'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to calculate team match score' });
  }
};

const getTeamsScoreInMatch = async (req, res) => {
  try {
    const result = await query(
      `SELECT tms.*, t.name as team_name
       FROM team_match_scores tms
       JOIN teams t ON tms.team_id = t.id
       WHERE tms.match_id = $1
       ORDER BY t.name`,
      [req.params.matchId]
    );
    
    res.json((result.rows));
  } catch (error) {
    logger.error('Error fetching team match scores:', error);
    res.status(500).json({ error: 'Failed to fetch team match scores' });
  }
};

const createMatch = async (req, res) => {
  try {
    const { homeTeamId, awayTeamId, sessionId, sessionNumber, matchDate, matchName } = req.body;
    
    if (!homeTeamId || !awayTeamId) {
      return res.status(400).json({ error: 'Home team ID and away team ID are required' });
    }

    if (homeTeamId === awayTeamId) {
      return res.status(400).json({ error: 'Home team and away team cannot be the same' });
    }

    await withTransaction(async (client) => {
      // Verify tournament exists
      const tournamentResult = await client.query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
      if (tournamentResult.rows.length === 0) {
        throw new Error('Tournament not found');
      }

      // Verify both teams are registered in the tournament
      const homeTeamResult = await client.query(
        'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
        [req.params.tournamentId, homeTeamId]
      );
      const awayTeamResult = await client.query(
        'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
        [req.params.tournamentId, awayTeamId]
      );

      if (homeTeamResult.rows.length === 0 || awayTeamResult.rows.length === 0) {
        throw new Error('Both teams must be registered in the tournament');
      }

      // Create the match
      const matchResult = await client.query(
        `INSERT INTO matches (tournament_id, home_team_id, away_team_id, session_id, session_number, match_date, match_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.params.tournamentId, homeTeamId, awayTeamId, sessionId || null, sessionNumber || null, matchDate ? new Date(matchDate) : null, matchName || null]
      );

      res.status(201).json((matchResult.rows[0]));
    });
  } catch (error) {
    logger.error('Error creating match:', error);
    
    if (['Tournament not found', 'Both teams must be registered in the tournament'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to create match' });
  }
};

const getMatchesByTournament = async (req, res) => {
  try {
    const result = await query(
      `SELECT m.*, ht.name as home_team_name, at.name as away_team_name, wt.name as winner_team_name,
              ls.session_name,
              mp.home_total_points, mp.away_total_points,
              mp.home_game1_points, mp.home_game2_points, mp.home_game3_points, mp.home_series_points,
              mp.away_game1_points, mp.away_game2_points, mp.away_game3_points, mp.away_series_points
       FROM matches m
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at ON m.away_team_id = at.id
       LEFT JOIN teams wt ON m.winner_team_id = wt.id
       LEFT JOIN league_sessions ls ON m.session_id = ls.id
       LEFT JOIN match_points mp ON m.id = mp.match_id
       WHERE m.tournament_id = $1
       ORDER BY m.session_number NULLS LAST, m.match_date NULLS LAST, m.created_at`,
      [req.params.tournamentId]
    );
    
    const enrichedMatches = result.rows.map(match => ({
      ...match,
      pointsBreakdown: match.home_total_points !== null ? {
        homeTeam: {
          game1Points: match.home_game1_points,
          game2Points: match.home_game2_points,
          game3Points: match.home_game3_points,
          seriesPoints: match.home_series_points,
          totalPoints: match.home_total_points
        },
        awayTeam: {
          game1Points: match.away_game1_points,
          game2Points: match.away_game2_points,
          game3Points: match.away_game3_points,
          seriesPoints: match.away_series_points,
          totalPoints: match.away_total_points
        }
      } : null
    }));
    
    res.json((enrichedMatches));
  } catch (error) {
    logger.error('Error fetching tournament matches:', error);
    res.status(500).json({ error: 'Failed to fetch tournament matches' });
  }
};

// New endpoint to get detailed points breakdown for a match
const getMatchPointsBreakdown = async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        mp.*,
        ht.name as home_team_name,
        at.name as away_team_name,
        m.status as match_status,
        -- Home team individual game totals
        (SELECT COALESCE(SUM(pms.game1_score), 0) FROM player_match_scores pms 
         WHERE pms.match_id = mp.match_id AND pms.team_id = mp.home_team_id) as home_game1_total,
        (SELECT COALESCE(SUM(pms.game2_score), 0) FROM player_match_scores pms 
         WHERE pms.match_id = mp.match_id AND pms.team_id = mp.home_team_id) as home_game2_total,
        (SELECT COALESCE(SUM(pms.game3_score), 0) FROM player_match_scores pms 
         WHERE pms.match_id = mp.match_id AND pms.team_id = mp.home_team_id) as home_game3_total,
        (SELECT COALESCE(SUM(pms.game1_score + pms.game2_score + pms.game3_score), 0) FROM player_match_scores pms 
         WHERE pms.match_id = mp.match_id AND pms.team_id = mp.home_team_id) as home_series_total,
        -- Away team individual game totals
        (SELECT COALESCE(SUM(pms.game1_score), 0) FROM player_match_scores pms 
         WHERE pms.match_id = mp.match_id AND pms.team_id = mp.away_team_id) as away_game1_total,
        (SELECT COALESCE(SUM(pms.game2_score), 0) FROM player_match_scores pms 
         WHERE pms.match_id = mp.match_id AND pms.team_id = mp.away_team_id) as away_game2_total,
        (SELECT COALESCE(SUM(pms.game3_score), 0) FROM player_match_scores pms 
         WHERE pms.match_id = mp.match_id AND pms.team_id = mp.away_team_id) as away_game3_total,
        (SELECT COALESCE(SUM(pms.game1_score + pms.game2_score + pms.game3_score), 0) FROM player_match_scores pms 
         WHERE pms.match_id = mp.match_id AND pms.team_id = mp.away_team_id) as away_series_total
       FROM match_points mp
       JOIN matches m ON mp.match_id = m.id
       JOIN teams ht ON mp.home_team_id = ht.id
       JOIN teams at ON mp.away_team_id = at.id
       WHERE mp.match_id = $1`,
      [req.params.matchId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Match points breakdown not found' });
    }

    const breakdown = result.rows[0];
    
    res.json(({
      matchId: breakdown.match_id,
      matchStatus: breakdown.match_status,
      homeTeam: {
        teamId: breakdown.home_team_id,
        teamName: breakdown.home_team_name,
        gameBreakdown: {
          game1: { score: breakdown.home_game1_total, points: breakdown.home_game1_points },
          game2: { score: breakdown.home_game2_total, points: breakdown.home_game2_points },
          game3: { score: breakdown.home_game3_total, points: breakdown.home_game3_points },
          series: { score: breakdown.home_series_total, points: breakdown.home_series_points }
        },
        totalPoints: breakdown.home_total_points
      },
      awayTeam: {
        teamId: breakdown.away_team_id,
        teamName: breakdown.away_team_name,
        gameBreakdown: {
          game1: { score: breakdown.away_game1_total, points: breakdown.away_game1_points },
          game2: { score: breakdown.away_game2_total, points: breakdown.away_game2_points },
          game3: { score: breakdown.away_game3_total, points: breakdown.away_game3_points },
          series: { score: breakdown.away_series_total, points: breakdown.away_series_points }
        },
        totalPoints: breakdown.away_total_points
      },
      calculatedAt: breakdown.calculated_at
    }));
  } catch (error) {
    logger.error('Error fetching match points breakdown:', error);
    res.status(500).json({ error: 'Failed to fetch match points breakdown' });
  }
};

// Legacy method kept for compatibility
const addTeamScoreInMatch = async (req, res) => {
  // Redirect to the new calculate method
  return calculateTeamScoreInMatch(req, res);
};

module.exports = {
  getMatchById,
  updateMatchStatus,
  addPlayerScoreInMatch,
  getPlayersMatchScore,
  addTeamScoreInMatch,
  getTeamsScoreInMatch,
  calculateTeamScoreInMatch,
  createMatch,
  getMatchesByTournament,
  getMatchPointsBreakdown
};