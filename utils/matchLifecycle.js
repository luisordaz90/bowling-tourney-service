// utils/matchLifecycle.js
// Reusable functions for match and session status transitions.
// Called from both submitScore (auto) and calculateTeamScoreInMatch (manual).

const logger = require('../config/logger');

/**
 * Sets match status to 'in_progress' if currently 'scheduled'.
 */
async function tryStartMatch(client, matchId) {
  await client.query(
    `UPDATE matches SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'scheduled'`,
    [matchId]
  );
}

/**
 * Checks if both teams have all active roster players' scores submitted.
 * If complete: calculates match points, updates match status to 'completed',
 * sets winner, and upserts team_statistics for both teams.
 *
 * @returns {{ matchCompleted: boolean }}
 */
async function tryCompleteMatch(client, matchId, tournamentId, gamesPerSession, lineupSize) {
  // Skip if already completed
  const matchStatus = await client.query(
    'SELECT status FROM matches WHERE id = $1',
    [matchId]
  );
  if (matchStatus.rows.length === 0 || matchStatus.rows[0].status === 'completed') {
    return { matchCompleted: matchStatus.rows[0]?.status === 'completed' };
  }

  // If lineupSize not provided, fetch from tournament
  if (!lineupSize) {
    const tournResult = await client.query(
      'SELECT lineup_size FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    lineupSize = tournResult.rows[0]?.lineup_size || 3;
  }

  // Completion check: each team must have lineup_size * games_per_session score rows.
  // Uses lineup_size instead of roster count so substitutions don't block completion
  // (a sub adds a distinct player but the total score rows stay the same).
  const completionResult = await client.query(
    `SELECT COUNT(DISTINCT sub.team_id) AS complete_teams
     FROM (
       SELECT s.team_id
       FROM scores s
       WHERE s.match_id = $1
       GROUP BY s.team_id
       HAVING COUNT(*) >= $2::INTEGER * $3::INTEGER
     ) sub`,
    [matchId, lineupSize, gamesPerSession]
  );

  const bothComplete = parseInt(completionResult.rows[0].complete_teams) === 2;
  if (!bothComplete) return { matchCompleted: false };

  // Calculate match points
  const pointsResult = await client.query(
    'SELECT * FROM calculate_match_points($1)',
    [matchId]
  );

  if (pointsResult.rows.length === 0) return { matchCompleted: false };
  const points = pointsResult.rows[0];

  // Upsert match_points
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
      matchId,
      points.home_team_id, points.away_team_id,
      JSON.stringify(points.home_game_pts), points.home_series_pts, points.home_total_pts,
      JSON.stringify(points.away_game_pts), points.away_series_pts, points.away_total_pts
    ]
  );

  // Determine winner
  let winnerTeamId = null;
  if (points.home_total_pts > points.away_total_pts) {
    winnerTeamId = points.home_team_id;
  } else if (points.away_total_pts > points.home_total_pts) {
    winnerTeamId = points.away_team_id;
  }

  // Complete the match
  await client.query(
    `UPDATE matches SET winner_team_id = $1, status = 'completed', updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [winnerTeamId, matchId]
  );

  const maxPtsPerMatch = gamesPerSession + 1;
  const homeIsWinner = winnerTeamId === points.home_team_id;
  const awayIsWinner = winnerTeamId === points.away_team_id;

  // Get team scores for statistics
  const homeScoreResult = await client.query(
    `SELECT SUM(score) AS total, ROUND(SUM(score)::DECIMAL / COUNT(*), 2) AS avg
     FROM scores WHERE match_id = $1 AND team_id = $2`,
    [matchId, points.home_team_id]
  );
  const awayScoreResult = await client.query(
    `SELECT SUM(score) AS total, ROUND(SUM(score)::DECIMAL / COUNT(*), 2) AS avg
     FROM scores WHERE match_id = $1 AND team_id = $2`,
    [matchId, points.away_team_id]
  );

  // Upsert home team statistics
  await upsertTeamStats(client, points.home_team_id, tournamentId, {
    won: homeIsWinner ? 1 : 0,
    lost: awayIsWinner ? 1 : 0,
    totalScore: parseInt(homeScoreResult.rows[0].total),
    avgScore: parseFloat(homeScoreResult.rows[0].avg),
    points: points.home_total_pts,
    maxPtsPerMatch,
  });

  // Upsert away team statistics
  await upsertTeamStats(client, points.away_team_id, tournamentId, {
    won: awayIsWinner ? 1 : 0,
    lost: homeIsWinner ? 1 : 0,
    totalScore: parseInt(awayScoreResult.rows[0].total),
    avgScore: parseFloat(awayScoreResult.rows[0].avg),
    points: points.away_total_pts,
    maxPtsPerMatch,
  });

  return { matchCompleted: true, winnerTeamId };
}

async function upsertTeamStats(client, teamId, tournamentId, { won, lost, totalScore, avgScore, points, maxPtsPerMatch }) {
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
    [teamId, tournamentId, won, lost, totalScore, avgScore, points, maxPtsPerMatch]
  );
}

/**
 * Auto-transitions session status based on its matches.
 * Only moves forward: scheduled → active → completed.
 * Never overrides 'cancelled'.
 */
async function tryTransitionSession(client, sessionId) {
  const statusResult = await client.query(
    'SELECT status FROM tournament_sessions WHERE id = $1',
    [sessionId]
  );
  if (statusResult.rows.length === 0) return;

  const currentStatus = statusResult.rows[0].status;
  if (currentStatus === 'cancelled' || currentStatus === 'completed') return;

  const matchStats = await client.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'completed') AS completed,
       COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress
     FROM matches
     WHERE session_id = $1`,
    [sessionId]
  );

  const { total, completed, in_progress } = matchStats.rows[0];
  const totalNum = parseInt(total);
  const completedNum = parseInt(completed);
  const inProgressNum = parseInt(in_progress);

  if (totalNum > 0 && completedNum === totalNum) {
    await client.query(
      "UPDATE tournament_sessions SET status = 'completed' WHERE id = $1",
      [sessionId]
    );

    // Recalculate handicaps for all players who scored in this session,
    // including subs who didn't play all games_per_session games.
    // The trigger only fires for players with a full set of games,
    // so partial-session players would otherwise be missed.
    // Wrapped in a savepoint so a failure doesn't abort the outer transaction.
    try {
      await client.query('SAVEPOINT recalc_hdcp');
      await recalculateSessionHandicaps(client, sessionId);
      await client.query('RELEASE SAVEPOINT recalc_hdcp');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT recalc_hdcp');
      logger.error({ err, sessionId }, 'Failed to recalculate session handicaps');
    }
  } else if (currentStatus === 'scheduled' && inProgressNum > 0) {
    await client.query(
      "UPDATE tournament_sessions SET status = 'active' WHERE id = $1",
      [sessionId]
    );
  }
}

/**
 * Recalculates handicaps for every player who scored in a session,
 * regardless of how many games they played. This catches substitutes
 * who the trigger skips because they have fewer than games_per_session scores.
 */
async function recalculateSessionHandicaps(client, sessionId) {
  // Get tournament info for this session
  const sessResult = await client.query(
    `SELECT ts.tournament_id, t.schedule_type, t.scoring_config
     FROM tournament_sessions ts
     JOIN tournaments t ON ts.tournament_id = t.id
     WHERE ts.id = $1`,
    [sessionId]
  );
  if (sessResult.rows.length === 0) return;

  const { tournament_id: tournamentId, schedule_type: scheduleType, scoring_config: config } = sessResult.rows[0];
  const isOpen = scheduleType === 'open';
  const matchFilter = isOpen ? 'AND match_id IS NULL' : 'AND match_id IS NOT NULL';

  // Find all distinct (player_id, team_id) combos who scored in this session
  const playersResult = await client.query(
    `SELECT DISTINCT player_id, team_id
     FROM scores
     WHERE session_id = $1 ${matchFilter}`,
    [sessionId]
  );

  if (playersResult.rows.length === 0) return;

  const hdcpBase = config?.handicap?.base_score ?? 220;
  const hdcpPct = (config?.handicap?.percentage ?? 90) / 100;
  const hdcpFloor = config?.handicap?.floor ?? 0;
  const hdcpCap = config?.handicap?.cap ?? null;

  for (const { player_id: playerId, team_id: teamId } of playersResult.rows) {
    // Aggregate all tournament scores for this player
    const agg = await client.query(
      `SELECT COUNT(DISTINCT session_id) AS sessions,
              COALESCE(SUM(score), 0)     AS total_pins,
              COUNT(*)                     AS total_games
       FROM scores
       WHERE tournament_id = $1
         AND player_id = $2
         ${matchFilter}`,
      [tournamentId, playerId]
    );

    const { sessions, total_pins: totalPins, total_games: totalGames } = agg.rows[0];
    const gamesNum = parseInt(totalGames);
    if (gamesNum === 0) continue;

    const pinsNum = parseInt(totalPins);
    const sessionsNum = parseInt(sessions);
    const avg = Math.round((pinsNum / gamesNum) * 100) / 100;

    // Handicap: floor((base - avg) * pct), clamped to [floor, cap]
    let hdcp = Math.max(hdcpFloor, Math.floor((hdcpBase - avg) * hdcpPct));
    if (hdcpCap != null) hdcp = Math.min(hdcp, hdcpCap);

    // Highest game
    const hgResult = await client.query(
      `SELECT COALESCE(MAX(score), 0) AS highest_game
       FROM scores
       WHERE tournament_id = $1 AND player_id = $2 ${matchFilter}`,
      [tournamentId, playerId]
    );

    // Highest series (sum per session)
    const hsResult = await client.query(
      `SELECT COALESCE(MAX(session_total), 0) AS highest_series
       FROM (
         SELECT session_id, SUM(score) AS session_total
         FROM scores
         WHERE tournament_id = $1 AND player_id = $2 ${matchFilter}
         GROUP BY session_id
       ) sub`,
      [tournamentId, playerId]
    );

    await client.query(
      `INSERT INTO player_statistics (
         player_id, tournament_id, team_id,
         games_played, total_pins, current_average,
         highest_game, highest_series,
         matches_played, current_handicap, last_updated
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
       ON CONFLICT (player_id, tournament_id, team_id) DO UPDATE SET
         games_played     = $4,
         total_pins       = $5,
         current_average  = $6,
         highest_game     = $7,
         highest_series   = $8,
         matches_played   = $9,
         current_handicap = $10,
         last_updated     = CURRENT_TIMESTAMP`,
      [
        playerId, tournamentId, teamId,
        gamesNum, pinsNum, avg,
        parseInt(hgResult.rows[0].highest_game),
        parseInt(hsResult.rows[0].highest_series),
        sessionsNum, hdcp,
      ]
    );
  }

  logger.info({ sessionId, playerCount: playersResult.rows.length }, 'Recalculated session handicaps');
}

module.exports = {
  tryStartMatch,
  tryCompleteMatch,
  tryTransitionSession,
};
