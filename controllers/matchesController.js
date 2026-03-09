// controllers/matchesController.js
const { query, withTransaction } = require('../config/database');
const logger = require('../config/logger');

const getMatchById = async (req, res) => {
  try {
    const result = await query(
      `SELECT m.*, ht.name as home_team_name, at.name as away_team_name, wt.name as winner_team_name,
              ls.session_name, t.name as tournament_name,
              mp.home_total_points, mp.away_total_points,
              mp.home_game_points, mp.away_game_points,
              mp.home_series_points, mp.away_series_points
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
    res.json({
      ...match,
      homeTeamName: match.home_team_name,
      awayTeamName: match.away_team_name,
      winnerTeamName: match.winner_team_name,
      sessionName: match.session_name,
      tournamentName: match.tournament_name,
      pointsBreakdown: match.home_total_points !== null ? {
        homeTeam: {
          gamePoints: match.home_game_points,
          seriesPoints: match.home_series_points,
          totalPoints: match.home_total_points
        },
        awayTeam: {
          gamePoints: match.away_game_points,
          seriesPoints: match.away_series_points,
          totalPoints: match.away_total_points
        }
      } : null
    });
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

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error updating match status:', error);
    res.status(500).json({ error: 'Failed to update match status' });
  }
};

// Submit all game scores for a player in a match.
// Inserts one row per game into the scores table.
// Submit game scores for a player in a match.
// Accepts scores as an array: { teamId, playerId, scores: [180, 200, 190], handicapApplied? }
// Length is validated against tournament.games_per_session after the match is fetched.
const addPlayerScoreInMatch = async (req, res) => {
  try {
    const { teamId, playerId, scores, handicapApplied } = req.body;

    if (!teamId || !playerId || !Array.isArray(scores) || scores.length === 0) {
      return res.status(400).json({ error: 'teamId, playerId, and scores[] are required' });
    }

    if (scores.some(s => s < 0 || s > 300)) {
      return res.status(400).json({ error: 'Game scores must be between 0 and 300' });
    }

    await withTransaction(async (client) => {
      const matchResult = await client.query(
        `SELECT m.*, t.games_per_session
         FROM matches m
         JOIN tournaments t ON m.tournament_id = t.id
         WHERE m.id = $1`,
        [req.params.matchId]
      );
      if (matchResult.rows.length === 0) {
        throw Object.assign(new Error('Match not found'), { status: 400 });
      }
      const match = matchResult.rows[0];
      const gamesPerSession = match.games_per_session;

      if (scores.length !== gamesPerSession) {
        throw Object.assign(
          new Error(`Expected ${gamesPerSession} scores, got ${scores.length}`),
          { status: 400 }
        );
      }

      if (teamId !== match.home_team_id && teamId !== match.away_team_id) {
        throw Object.assign(new Error('Team is not part of this match'), { status: 400 });
      }

      const playerResult = await client.query('SELECT id FROM players WHERE id = $1', [playerId]);
      if (playerResult.rows.length === 0) {
        throw Object.assign(new Error('Player not found'), { status: 400 });
      }

      const existingResult = await client.query(
        'SELECT id FROM scores WHERE match_id = $1 AND player_id = $2 LIMIT 1',
        [req.params.matchId, playerId]
      );
      if (existingResult.rows.length > 0) {
        throw Object.assign(new Error('Score already recorded for this player in this match'), { status: 400 });
      }

      const hdcp = handicapApplied || 0;
      const insertedRows = [];

      for (let i = 0; i < gamesPerSession; i++) {
        const r = await client.query(
          `INSERT INTO scores
             (session_id, tournament_id, player_id, team_id, match_id,
              game_number, score, handicap_applied)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [match.session_id, match.tournament_id, playerId, teamId,
           match.id, i + 1, scores[i], hdcp]
        );
        insertedRows.push(r.rows[0]);
      }

      const totalScore = scores.reduce((s, g) => s + g, 0);
      await client.query(
        `UPDATE players
         SET total_games_played = total_games_played + $1,
             total_pins         = total_pins + $2,
             average_score      = CASE
               WHEN total_games_played + $1 > 0
               THEN ROUND((total_pins + $2)::DECIMAL / (total_games_played + $1), 2)
               ELSE 0
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [gamesPerSession, totalScore, playerId]
      );

      res.status(201).json({
        matchId: match.id,
        playerId,
        teamId,
        handicapApplied: hdcp,
        games: insertedRows.map(r => ({ gameNumber: r.game_number, score: r.score }))
      });
    });
  } catch (error) {
    logger.error('Error recording player match score:', error);
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to record player match score' });
  }
};

// Returns per-player aggregated scores for a match (one object per player).
const getPlayersMatchScore = async (req, res) => {
  try {
    const result = await query(
      `SELECT
         s.player_id,
         s.team_id,
         p.name                                               AS player_name,
         t.name                                               AS team_name,
         MAX(CASE WHEN s.game_number = 1 THEN s.score END)   AS game1_score,
         MAX(CASE WHEN s.game_number = 2 THEN s.score END)   AS game2_score,
         MAX(CASE WHEN s.game_number = 3 THEN s.score END)   AS game3_score,
         MAX(s.handicap_applied)                             AS handicap_applied,
         MIN(s.recorded_at)                                  AS created_at
       FROM scores s
       JOIN players p ON s.player_id = p.id
       JOIN teams   t ON s.team_id   = t.id
       WHERE s.match_id = $1
       GROUP BY s.player_id, s.team_id, p.name, t.name
       ORDER BY t.name, p.name`,
      [req.params.matchId]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching player match scores:', error);
    res.status(500).json({ error: 'Failed to fetch player match scores' });
  }
};

// Computes team-level totals from scores, triggers point calculation when both
// teams have submitted all games, and updates match/team statistics.
const calculateTeamScoreInMatch = async (req, res) => {
  try {
    const { teamId } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    await withTransaction(async (client) => {
      const matchResult = await client.query(
        `SELECT m.*, t.games_per_session
         FROM matches m
         JOIN tournaments t ON m.tournament_id = t.id
         WHERE m.id = $1`,
        [req.params.matchId]
      );
      if (matchResult.rows.length === 0) {
        throw Object.assign(new Error('Match not found'), { status: 400 });
      }
      const match = matchResult.rows[0];
      const gamesPerSession = match.games_per_session;

      if (teamId !== match.home_team_id && teamId !== match.away_team_id) {
        throw Object.assign(new Error('Team is not part of this match'), { status: 400 });
      }

      // Compute team totals from scores
      const teamScoreResult = await client.query(
        `SELECT
           SUM(s.score)                              AS total_team_score,
           SUM(s.handicap_applied)                   AS total_handicap,
           ROUND(SUM(s.score)::DECIMAL / COUNT(*), 2) AS team_average,
           COUNT(*)                                   AS games_played
         FROM scores s
         WHERE s.match_id = $1 AND s.team_id = $2`,
        [req.params.matchId, teamId]
      );

      if (!teamScoreResult.rows[0].games_played || parseInt(teamScoreResult.rows[0].games_played) === 0) {
        throw Object.assign(new Error('No player scores found for this team in this match'), { status: 400 });
      }

      const teamScore = teamScoreResult.rows[0];

      // Check if both teams have submitted all games
      const teamCountResult = await client.query(
        `SELECT COUNT(DISTINCT team_id) AS team_count
         FROM (
           SELECT team_id
           FROM scores
           WHERE match_id = $1
           GROUP BY team_id
           HAVING COUNT(*) >= $2
         ) complete_teams`,
        [req.params.matchId, gamesPerSession]
      );
      const bothComplete = parseInt(teamCountResult.rows[0].team_count) === 2;

      if (bothComplete) {
        const pointsResult = await client.query(
          'SELECT * FROM calculate_match_points($1)',
          [req.params.matchId]
        );

        if (pointsResult.rows.length > 0) {
          const points = pointsResult.rows[0];

          await client.query(
            `INSERT INTO match_points (
               match_id, home_team_id, away_team_id,
               home_game_points, home_series_points, home_total_points,
               away_game_points, away_series_points, away_total_points
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (match_id) DO UPDATE SET
               home_game_points   = EXCLUDED.home_game_points,
               home_series_points = EXCLUDED.home_series_points,
               home_total_points  = EXCLUDED.home_total_points,
               away_game_points   = EXCLUDED.away_game_points,
               away_series_points = EXCLUDED.away_series_points,
               away_total_points  = EXCLUDED.away_total_points,
               calculated_at      = CURRENT_TIMESTAMP`,
            [
              req.params.matchId,
              points.home_team_id, points.away_team_id,
              JSON.stringify(points.home_game_pts), points.home_series_pts, points.home_total_pts,
              JSON.stringify(points.away_game_pts), points.away_series_pts, points.away_total_pts
            ]
          );

          let winnerTeamId = null;
          if (points.home_total_pts > points.away_total_pts) {
            winnerTeamId = points.home_team_id;
          } else if (points.away_total_pts > points.home_total_pts) {
            winnerTeamId = points.away_team_id;
          }

          await client.query(
            `UPDATE matches
             SET winner_team_id = $1, status = 'completed', updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [winnerTeamId, req.params.matchId]
          );

          const maxPtsPerMatch = gamesPerSession + 1;
          const homeIsWinner = winnerTeamId === points.home_team_id;
          const awayIsWinner = winnerTeamId === points.away_team_id;

          // Update home team stats
          await client.query(
            `INSERT INTO team_statistics (team_id, tournament_id, total_matches_played, matches_won, matches_lost,
               total_team_score, team_average, total_points)
             VALUES ($1, $2, 1, $3, $4, $5, $6, $7)
             ON CONFLICT (team_id, tournament_id) DO UPDATE SET
               total_matches_played = team_statistics.total_matches_played + 1,
               matches_won          = team_statistics.matches_won + $3,
               matches_lost         = team_statistics.matches_lost + $4,
               total_team_score     = team_statistics.total_team_score + $5,
               total_points         = team_statistics.total_points + $7,
               team_average         = CASE
                 WHEN (team_statistics.total_matches_played + 1) > 0
                 THEN ROUND((team_statistics.total_team_score + $5)::DECIMAL / (team_statistics.total_matches_played + 1), 2)
                 ELSE 0 END,
               points_percentage    = CASE
                 WHEN (team_statistics.total_matches_played + 1) > 0
                 THEN ROUND(((team_statistics.total_points + $7)::DECIMAL / ((team_statistics.total_matches_played + 1) * $8)) * 100, 2)
                 ELSE 0 END,
               last_updated         = CURRENT_TIMESTAMP`,
            [points.home_team_id, match.tournament_id,
             homeIsWinner ? 1 : 0, awayIsWinner ? 1 : 0,
             parseInt(teamScore.total_team_score), parseFloat(teamScore.team_average),
             points.home_total_pts, maxPtsPerMatch]
          );

          // Get away team score for its stats update
          const awayScoreResult = await client.query(
            `SELECT SUM(score) AS total, ROUND(SUM(score)::DECIMAL / COUNT(*), 2) AS avg
             FROM scores WHERE match_id = $1 AND team_id = $2`,
            [req.params.matchId, points.away_team_id]
          );
          const awayTotal = parseInt(awayScoreResult.rows[0]?.total || 0);
          const awayAvg   = parseFloat(awayScoreResult.rows[0]?.avg   || 0);

          await client.query(
            `INSERT INTO team_statistics (team_id, tournament_id, total_matches_played, matches_won, matches_lost,
               total_team_score, team_average, total_points)
             VALUES ($1, $2, 1, $3, $4, $5, $6, $7)
             ON CONFLICT (team_id, tournament_id) DO UPDATE SET
               total_matches_played = team_statistics.total_matches_played + 1,
               matches_won          = team_statistics.matches_won + $3,
               matches_lost         = team_statistics.matches_lost + $4,
               total_team_score     = team_statistics.total_team_score + $5,
               total_points         = team_statistics.total_points + $7,
               team_average         = CASE
                 WHEN (team_statistics.total_matches_played + 1) > 0
                 THEN ROUND((team_statistics.total_team_score + $5)::DECIMAL / (team_statistics.total_matches_played + 1), 2)
                 ELSE 0 END,
               points_percentage    = CASE
                 WHEN (team_statistics.total_matches_played + 1) > 0
                 THEN ROUND(((team_statistics.total_points + $7)::DECIMAL / ((team_statistics.total_matches_played + 1) * $8)) * 100, 2)
                 ELSE 0 END,
               last_updated         = CURRENT_TIMESTAMP`,
            [points.away_team_id, match.tournament_id,
             awayIsWinner ? 1 : 0, homeIsWinner ? 1 : 0,
             awayTotal, awayAvg,
             points.away_total_pts, maxPtsPerMatch]
          );
        }
      }

      res.status(201).json({
        matchId: match.id,
        teamId,
        totalTeamScore: parseInt(teamScore.total_team_score),
        totalHandicap: parseInt(teamScore.total_handicap),
        teamAverage: parseFloat(teamScore.team_average),
        gamesPlayed: parseInt(teamScore.games_played),
        matchCompleted: bothComplete,
        message: bothComplete ? 'Match completed and points calculated' : 'Team score recorded'
      });
    });
  } catch (error) {
    logger.error('Error calculating team match score:', error);
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to calculate team match score' });
  }
};

// Returns computed team totals for a match (derived from scores, not stored).
const getTeamsScoreInMatch = async (req, res) => {
  try {
    const result = await query(
      `SELECT
         s.team_id,
         t.name                                                AS team_name,
         SUM(s.score)                                         AS total_team_score,
         SUM(s.handicap_applied)                              AS total_handicap,
         ROUND(SUM(s.score)::DECIMAL / COUNT(*), 2)           AS team_average,
         COUNT(*)                                             AS games_played,
         MIN(s.recorded_at)                                   AS recorded_at
       FROM scores s
       JOIN teams t ON s.team_id = t.id
       WHERE s.match_id = $1
       GROUP BY s.team_id, t.name
       ORDER BY t.name`,
      [req.params.matchId]
    );
    res.json(result.rows);
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
      const tournamentResult = await client.query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
      if (tournamentResult.rows.length === 0) {
        throw Object.assign(new Error('Tournament not found'), { status: 400 });
      }

      const homeTeamResult = await client.query(
        'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
        [req.params.tournamentId, homeTeamId]
      );
      const awayTeamResult = await client.query(
        'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
        [req.params.tournamentId, awayTeamId]
      );

      if (homeTeamResult.rows.length === 0 || awayTeamResult.rows.length === 0) {
        throw Object.assign(new Error('Both teams must be registered in the tournament'), { status: 400 });
      }

      const matchResult = await client.query(
        `INSERT INTO matches (tournament_id, home_team_id, away_team_id, session_id, session_number, match_date, match_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.params.tournamentId, homeTeamId, awayTeamId,
         sessionId || null, sessionNumber || null,
         matchDate ? new Date(matchDate) : null, matchName || null]
      );

      res.status(201).json(matchResult.rows[0]);
    });
  } catch (error) {
    logger.error('Error creating match:', error);
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
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
              mp.home_game_points, mp.away_game_points,
              mp.home_series_points, mp.away_series_points
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
          gamePoints: match.home_game_points,
          seriesPoints: match.home_series_points,
          totalPoints: match.home_total_points
        },
        awayTeam: {
          gamePoints: match.away_game_points,
          seriesPoints: match.away_series_points,
          totalPoints: match.away_total_points
        }
      } : null
    }));

    res.json(enrichedMatches);
  } catch (error) {
    logger.error('Error fetching tournament matches:', error);
    res.status(500).json({ error: 'Failed to fetch tournament matches' });
  }
};

const getMatchPointsBreakdown = async (req, res) => {
  try {
    const mpResult = await query(
      `SELECT mp.*,
              ht.name AS home_team_name,
              at.name AS away_team_name,
              m.status AS match_status
       FROM match_points mp
       JOIN matches m  ON mp.match_id      = m.id
       JOIN teams   ht ON mp.home_team_id  = ht.id
       JOIN teams   at ON mp.away_team_id  = at.id
       WHERE mp.match_id = $1`,
      [req.params.matchId]
    );

    if (mpResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match points breakdown not found' });
    }

    const mp = mpResult.rows[0];

    // Fetch per-game pin totals for both teams
    const scoreResult = await query(
      `SELECT team_id, game_number, SUM(score) AS game_total
       FROM scores
       WHERE match_id = $1
       GROUP BY team_id, game_number
       ORDER BY team_id, game_number`,
      [req.params.matchId]
    );

    const homeTotals = scoreResult.rows
      .filter(r => r.team_id === mp.home_team_id)
      .map(r => ({ game: r.game_number, score: parseInt(r.game_total) }));

    const awayTotals = scoreResult.rows
      .filter(r => r.team_id === mp.away_team_id)
      .map(r => ({ game: r.game_number, score: parseInt(r.game_total) }));

    const homeGamePts = mp.home_game_points || [];
    const awayGamePts = mp.away_game_points || [];

    res.json({
      matchId: mp.match_id,
      matchStatus: mp.match_status,
      homeTeam: {
        teamId: mp.home_team_id,
        teamName: mp.home_team_name,
        gameBreakdown: homeTotals.map((g, i) => ({
          game: g.game,
          score: g.score,
          points: homeGamePts[i] ?? 0
        })),
        seriesScore: homeTotals.reduce((s, g) => s + g.score, 0),
        seriesPoints: mp.home_series_points,
        totalPoints: mp.home_total_points
      },
      awayTeam: {
        teamId: mp.away_team_id,
        teamName: mp.away_team_name,
        gameBreakdown: awayTotals.map((g, i) => ({
          game: g.game,
          score: g.score,
          points: awayGamePts[i] ?? 0
        })),
        seriesScore: awayTotals.reduce((s, g) => s + g.score, 0),
        seriesPoints: mp.away_series_points,
        totalPoints: mp.away_total_points
      },
      calculatedAt: mp.calculated_at
    });
  } catch (error) {
    logger.error('Error fetching match points breakdown:', error);
    res.status(500).json({ error: 'Failed to fetch match points breakdown' });
  }
};

// Legacy alias
const addTeamScoreInMatch = (req, res) => calculateTeamScoreInMatch(req, res);

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
