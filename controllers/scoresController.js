// controllers/scoresController.js
// Unified score CRUD for both 'open' and 'paired' tournament formats.
// All endpoints are session-scoped: /tournaments/:tournamentId/sessions/:sessionNumber/scores
// For paired format, the match is resolved internally from teamId + session.
const { query, withTransaction } = require('../config/database');
const logger = require('../config/logger');
const { validateScore } = require('../utils/helpers');

// ── Shared helpers ────────────────────────────────────────────────────────────

async function lookupTournamentAndSession(tournamentId, sessionNumber) {
  const tournamentResult = await query(
    'SELECT id, schedule_type, games_per_session FROM tournaments WHERE id = $1',
    [tournamentId]
  );
  if (tournamentResult.rows.length === 0) return { error: 'Tournament not found', status: 404 };
  const tournament = tournamentResult.rows[0];

  const sessionResult = await query(
    'SELECT id FROM league_sessions WHERE tournament_id = $1 AND session_number = $2',
    [tournamentId, sessionNumber]
  );
  if (sessionResult.rows.length === 0) return { error: 'Session not found', status: 404 };

  return { tournament, sessionId: sessionResult.rows[0].id };
}

async function resolveMatch(client, sessionId, teamId) {
  const result = await client.query(
    `SELECT id, home_team_id, away_team_id
     FROM matches
     WHERE session_id = $1 AND (home_team_id = $2 OR away_team_id = $2)`,
    [sessionId, teamId]
  );
  if (result.rows.length === 0) {
    throw Object.assign(new Error('No match found for this team in the specified session'), { status: 404 });
  }
  return result.rows[0];
}

// Handicap recalculation is handled entirely by the DB trigger trg_recalculate_hdcp
// (migration 015). It fires AFTER INSERT, UPDATE, and DELETE on scores for open-format rows.

// Reverse+recompute match points and team_statistics after a paired score change.
// Used by both updateScore and deleteScore for paired format.
async function recomputeMatchCompletion(client, matchId, match, gamesPerSession) {
  const mpResult = await client.query(
    'SELECT * FROM match_points WHERE match_id = $1',
    [matchId]
  );

  if (mpResult.rows.length === 0) return;

  const oldPoints = mpResult.rows[0];
  const maxPtsPerMatch = gamesPerSession + 1;
  const oldHomeIsWinner = match.winner_team_id === oldPoints.home_team_id;
  const oldAwayIsWinner = match.winner_team_id === oldPoints.away_team_id;

  // Reverse old team_statistics for both teams
  await client.query(
    `UPDATE team_statistics
     SET total_matches_played = GREATEST(0, total_matches_played - 1),
         matches_won  = GREATEST(0, matches_won - $3),
         matches_lost = GREATEST(0, matches_lost - $4),
         total_points = GREATEST(0, total_points - $5),
         last_updated = CURRENT_TIMESTAMP
     WHERE team_id = $1 AND tournament_id = $2`,
    [oldPoints.home_team_id, match.tournament_id,
     oldHomeIsWinner ? 1 : 0, oldAwayIsWinner ? 1 : 0,
     parseInt(oldPoints.home_total_points)]
  );

  await client.query(
    `UPDATE team_statistics
     SET total_matches_played = GREATEST(0, total_matches_played - 1),
         matches_won  = GREATEST(0, matches_won - $3),
         matches_lost = GREATEST(0, matches_lost - $4),
         total_points = GREATEST(0, total_points - $5),
         last_updated = CURRENT_TIMESTAMP
     WHERE team_id = $1 AND tournament_id = $2`,
    [oldPoints.away_team_id, match.tournament_id,
     oldAwayIsWinner ? 1 : 0, oldHomeIsWinner ? 1 : 0,
     parseInt(oldPoints.away_total_points)]
  );

  // Recompute match points
  const pointsResult = await client.query(
    'SELECT * FROM calculate_match_points($1)',
    [matchId]
  );
  const points = pointsResult.rows[0];

  await client.query(
    `UPDATE match_points SET
       home_game_points   = $2,
       home_series_points = $3,
       home_total_points  = $4,
       away_game_points   = $5,
       away_series_points = $6,
       away_total_points  = $7,
       calculated_at      = CURRENT_TIMESTAMP
     WHERE match_id = $1`,
    [matchId,
     JSON.stringify(points.home_game_pts), points.home_series_pts, points.home_total_pts,
     JSON.stringify(points.away_game_pts), points.away_series_pts, points.away_total_pts]
  );

  let winnerTeamId = null;
  if (points.home_total_pts > points.away_total_pts) {
    winnerTeamId = points.home_team_id;
  } else if (points.away_total_pts > points.home_total_pts) {
    winnerTeamId = points.away_team_id;
  }

  await client.query(
    'UPDATE matches SET winner_team_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [winnerTeamId, matchId]
  );

  // Re-apply team_statistics
  const homeIsWinner = winnerTeamId === points.home_team_id;
  const awayIsWinner = winnerTeamId === points.away_team_id;

  const homeScoreResult = await client.query(
    'SELECT COALESCE(SUM(score), 0)::INTEGER AS total FROM scores WHERE match_id = $1 AND team_id = $2',
    [matchId, points.home_team_id]
  );
  const awayScoreResult = await client.query(
    'SELECT COALESCE(SUM(score), 0)::INTEGER AS total FROM scores WHERE match_id = $1 AND team_id = $2',
    [matchId, points.away_team_id]
  );
  const homeTotal = parseInt(homeScoreResult.rows[0].total);
  const awayTotal = parseInt(awayScoreResult.rows[0].total);

  await client.query(
    `UPDATE team_statistics
     SET total_matches_played = total_matches_played + 1,
         matches_won  = matches_won + $3,
         matches_lost = matches_lost + $4,
         total_team_score = total_team_score + $5,
         total_points = total_points + $6,
         team_average = CASE WHEN (total_matches_played + 1) > 0
           THEN ROUND((total_team_score + $5)::DECIMAL / (total_matches_played + 1), 2)
           ELSE 0 END,
         points_percentage = CASE WHEN (total_matches_played + 1) > 0
           THEN ROUND(((total_points + $6)::DECIMAL / ((total_matches_played + 1) * $7)) * 100, 2)
           ELSE 0 END,
         last_updated = CURRENT_TIMESTAMP
     WHERE team_id = $1 AND tournament_id = $2`,
    [points.home_team_id, match.tournament_id,
     homeIsWinner ? 1 : 0, awayIsWinner ? 1 : 0,
     homeTotal, points.home_total_pts, maxPtsPerMatch]
  );

  await client.query(
    `UPDATE team_statistics
     SET total_matches_played = total_matches_played + 1,
         matches_won  = matches_won + $3,
         matches_lost = matches_lost + $4,
         total_team_score = total_team_score + $5,
         total_points = total_points + $6,
         team_average = CASE WHEN (total_matches_played + 1) > 0
           THEN ROUND((total_team_score + $5)::DECIMAL / (total_matches_played + 1), 2)
           ELSE 0 END,
         points_percentage = CASE WHEN (total_matches_played + 1) > 0
           THEN ROUND(((total_points + $6)::DECIMAL / ((total_matches_played + 1) * $7)) * 100, 2)
           ELSE 0 END,
         last_updated = CURRENT_TIMESTAMP
     WHERE team_id = $1 AND tournament_id = $2`,
    [points.away_team_id, match.tournament_id,
     awayIsWinner ? 1 : 0, homeIsWinner ? 1 : 0,
     awayTotal, points.away_total_pts, maxPtsPerMatch]
  );
}

// Reverse match completion state entirely (for DELETE).
async function reverseMatchCompletion(client, matchId, match, gamesPerSession) {
  const mpResult = await client.query(
    'SELECT * FROM match_points WHERE match_id = $1',
    [matchId]
  );

  if (mpResult.rows.length === 0) return;

  const mp = mpResult.rows[0];
  const homeIsWinner = match.winner_team_id === mp.home_team_id;
  const awayIsWinner = match.winner_team_id === mp.away_team_id;

  // Get team score totals before deleting
  const homeScoreResult = await client.query(
    'SELECT COALESCE(SUM(score), 0)::INTEGER AS total FROM scores WHERE match_id = $1 AND team_id = $2',
    [matchId, mp.home_team_id]
  );
  const awayScoreResult = await client.query(
    'SELECT COALESCE(SUM(score), 0)::INTEGER AS total FROM scores WHERE match_id = $1 AND team_id = $2',
    [matchId, mp.away_team_id]
  );

  await client.query(
    `UPDATE team_statistics
     SET total_matches_played = GREATEST(0, total_matches_played - 1),
         matches_won  = GREATEST(0, matches_won - $3),
         matches_lost = GREATEST(0, matches_lost - $4),
         total_team_score = GREATEST(0, total_team_score - $5),
         total_points = GREATEST(0, total_points - $6),
         last_updated = CURRENT_TIMESTAMP
     WHERE team_id = $1 AND tournament_id = $2`,
    [mp.home_team_id, match.tournament_id,
     homeIsWinner ? 1 : 0, awayIsWinner ? 1 : 0,
     parseInt(homeScoreResult.rows[0].total), parseInt(mp.home_total_points)]
  );

  await client.query(
    `UPDATE team_statistics
     SET total_matches_played = GREATEST(0, total_matches_played - 1),
         matches_won  = GREATEST(0, matches_won - $3),
         matches_lost = GREATEST(0, matches_lost - $4),
         total_team_score = GREATEST(0, total_team_score - $5),
         total_points = GREATEST(0, total_points - $6),
         last_updated = CURRENT_TIMESTAMP
     WHERE team_id = $1 AND tournament_id = $2`,
    [mp.away_team_id, match.tournament_id,
     awayIsWinner ? 1 : 0, homeIsWinner ? 1 : 0,
     parseInt(awayScoreResult.rows[0].total), parseInt(mp.away_total_points)]
  );

  await client.query('DELETE FROM match_points WHERE match_id = $1', [matchId]);

  await client.query(
    `UPDATE matches SET status = 'in_progress', winner_team_id = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [matchId]
  );
}

// ── POST /tournaments/:tournamentId/sessions/:sessionNumber/scores ──────────

const submitScore = async (req, res) => {
  const { tournamentId, sessionNumber } = req.params;
  const { playerId, teamId, scores } = req.body;

  if (!playerId || !Array.isArray(scores) || scores.length === 0) {
    return res.status(400).json({ error: 'playerId and scores[] are required' });
  }

  if (scores.some(s => !validateScore(s))) {
    return res.status(400).json({ error: 'Scores must be between 0 and 300' });
  }

  try {
    const lookup = await lookupTournamentAndSession(tournamentId, sessionNumber);
    if (lookup.error) return res.status(lookup.status).json({ error: lookup.error });
    const { tournament, sessionId } = lookup;
    const { schedule_type, games_per_session } = tournament;

    if (scores.length !== games_per_session) {
      return res.status(400).json({ error: `Expected ${games_per_session} scores, got ${scores.length}` });
    }

    // ── Open format ──────────────────────────────────────────────────────────
    if (schedule_type === 'open') {
      const playerResult = await query('SELECT id FROM players WHERE id = $1', [playerId]);
      if (playerResult.rows.length === 0) {
        return res.status(404).json({ error: 'Player not found' });
      }

      const existingResult = await query(
        'SELECT id FROM scores WHERE session_id = $1 AND player_id = $2 AND match_id IS NULL LIMIT 1',
        [sessionId, playerId]
      );
      if (existingResult.rows.length > 0) {
        return res.status(400).json({ error: 'Score already recorded for this player in this session' });
      }

      const statsResult = await query(
        'SELECT current_handicap FROM player_statistics WHERE player_id = $1 AND tournament_id = $2',
        [playerId, tournamentId]
      );
      const handicapApplied = statsResult.rows.length > 0 ? statsResult.rows[0].current_handicap : 0;

      let firstRow;
      await withTransaction(async (client) => {
        for (let i = 0; i < games_per_session; i++) {
          const r = await client.query(
            `INSERT INTO scores
               (session_id, tournament_id, player_id, team_id, match_id,
                game_number, score, handicap_applied)
             VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)
             RETURNING *`,
            [sessionId, tournamentId, playerId, teamId || null,
             i + 1, scores[i], handicapApplied]
          );
          if (i === 0) firstRow = r.rows[0];
        }
      });

      const rawTotal = scores.reduce((s, g) => s + g, 0);
      const totalPins = rawTotal + handicapApplied * games_per_session;

      return res.status(201).json({
        id: firstRow.id,
        tournamentId,
        sessionId,
        sessionNumber: parseInt(sessionNumber),
        matchId: null,
        playerId,
        teamId: teamId || null,
        scores,
        handicapApplied,
        totalPins,
        sessionAverage: rawTotal / games_per_session,
        recordedAt: firstRow.recorded_at
      });
    }

    // ── Paired format ────────────────────────────────────────────────────────
    if (!teamId) {
      return res.status(400).json({ error: 'teamId is required for paired format tournaments' });
    }

    let responsePayload;

    await withTransaction(async (client) => {
      const match = await resolveMatch(client, sessionId, teamId);

      const playerResult = await client.query('SELECT id FROM players WHERE id = $1', [playerId]);
      if (playerResult.rows.length === 0) {
        throw Object.assign(new Error('Player not found'), { status: 404 });
      }

      const existing = await client.query(
        'SELECT id FROM scores WHERE match_id = $1 AND player_id = $2 LIMIT 1',
        [match.id, playerId]
      );
      if (existing.rows.length > 0) {
        throw Object.assign(new Error('Score already recorded for this player in this session'), { status: 400 });
      }

      const statsResult = await client.query(
        'SELECT current_handicap FROM player_statistics WHERE player_id = $1 AND tournament_id = $2',
        [playerId, tournamentId]
      );
      const handicapApplied = statsResult.rows.length > 0 ? statsResult.rows[0].current_handicap : 0;

      let firstRow;
      for (let i = 0; i < games_per_session; i++) {
        const r = await client.query(
          `INSERT INTO scores
             (session_id, tournament_id, player_id, team_id, match_id,
              game_number, score, handicap_applied)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [sessionId, tournamentId, playerId, teamId, match.id,
           i + 1, scores[i], handicapApplied]
        );
        if (i === 0) firstRow = r.rows[0];
      }

      // Player statistics (games, pins, average) handled by DB trigger (trg_recalculate_hdcp)

      const rawTotal = scores.reduce((s, g) => s + g, 0);
      const totalPins = rawTotal + handicapApplied * games_per_session;
      responsePayload = {
        id: firstRow.id,
        tournamentId,
        sessionId,
        sessionNumber: parseInt(sessionNumber),
        matchId: match.id,
        playerId,
        teamId,
        scores,
        handicapApplied,
        totalPins,
        sessionAverage: rawTotal / games_per_session,
        recordedAt: firstRow.recorded_at
      };
    });

    return res.status(201).json(responsePayload);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === '23505') return res.status(400).json({ error: 'Score already recorded for this player in this session' });
    logger.error('Error submitting score:', error);
    res.status(500).json({ error: 'Failed to submit score' });
  }
};

// ── GET /tournaments/:tournamentId/sessions/:sessionNumber/scores ───────────

const getScores = async (req, res) => {
  const { tournamentId, sessionNumber } = req.params;

  try {
    const tournamentResult = await query(
      'SELECT id, schedule_type FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    const { schedule_type } = tournamentResult.rows[0];

    if (schedule_type === 'open') {
      const result = await query(
        `SELECT
           s.player_id,
           p.name                                               AS player_name,
           s.team_id,
           t.name                                               AS team_name,
           MAX(s.handicap_applied)                             AS handicap_applied,
           SUM(s.pins_with_hdcp)                               AS total_pins,
           ROUND(SUM(s.score)::DECIMAL / COUNT(*), 2)          AS session_average,
           MIN(s.recorded_at)                                  AS recorded_at,
           ARRAY_AGG(s.score ORDER BY s.game_number)           AS scores
         FROM   scores s
         JOIN   league_sessions ls ON s.session_id  = ls.id
         JOIN   players          p  ON s.player_id  = p.id
         LEFT JOIN teams         t  ON s.team_id    = t.id
         WHERE  s.tournament_id  = $1
           AND  ls.session_number = $2
           AND  s.match_id IS NULL
         GROUP BY s.player_id, p.name, s.team_id, t.name
         ORDER BY total_pins DESC`,
        [tournamentId, sessionNumber]
      );

      return res.json(result.rows.map(row => ({
        tournamentId,
        sessionNumber: parseInt(sessionNumber),
        playerId: row.player_id,
        playerName: row.player_name,
        teamId: row.team_id,
        teamName: row.team_name,
        scores: row.scores.map(Number),
        handicapApplied: row.handicap_applied,
        totalPins: parseInt(row.total_pins),
        sessionAverage: parseFloat(row.session_average),
        recordedAt: row.recorded_at
      })));
    }

    // Paired format
    const result = await query(
      `SELECT
         s.player_id,
         p.name                                               AS player_name,
         s.team_id,
         t.name                                               AS team_name,
         s.match_id,
         MAX(s.handicap_applied)                             AS handicap_applied,
         MIN(s.recorded_at)                                  AS recorded_at,
         ARRAY_AGG(s.score ORDER BY s.game_number)           AS scores
       FROM   scores s
       JOIN   league_sessions ls ON s.session_id  = ls.id
       JOIN   players          p  ON s.player_id  = p.id
       JOIN   teams             t  ON s.team_id   = t.id
       WHERE  s.tournament_id   = $1
         AND  ls.session_number = $2
         AND  s.match_id IS NOT NULL
       GROUP BY s.player_id, p.name, s.team_id, t.name, s.match_id
       ORDER BY t.name, p.name`,
      [tournamentId, sessionNumber]
    );

    return res.json(result.rows.map(row => ({
      tournamentId,
      sessionNumber: parseInt(sessionNumber),
      matchId: row.match_id,
      playerId: row.player_id,
      playerName: row.player_name,
      teamId: row.team_id,
      teamName: row.team_name,
      scores: row.scores.map(Number),
      handicapApplied: row.handicap_applied,
      recordedAt: row.recorded_at
    })));
  } catch (error) {
    logger.error('Error fetching scores:', error);
    res.status(500).json({ error: 'Failed to fetch scores' });
  }
};

// ── PUT /tournaments/:tournamentId/sessions/:sessionNumber/scores/:playerId ─

const updateScore = async (req, res) => {
  const { tournamentId, sessionNumber, playerId } = req.params;
  const { teamId, scores } = req.body;

  if (!Array.isArray(scores) || scores.length === 0) {
    return res.status(400).json({ error: 'scores[] is required' });
  }

  if (scores.some(s => !validateScore(s))) {
    return res.status(400).json({ error: 'Scores must be between 0 and 300' });
  }

  try {
    const lookup = await lookupTournamentAndSession(tournamentId, sessionNumber);
    if (lookup.error) return res.status(lookup.status).json({ error: lookup.error });
    const { tournament, sessionId } = lookup;
    const { schedule_type, games_per_session } = tournament;

    if (scores.length !== games_per_session) {
      return res.status(400).json({ error: `Expected ${games_per_session} scores, got ${scores.length}` });
    }

    let responsePayload;

    await withTransaction(async (client) => {
      if (schedule_type === 'open') {
        // ── Open format ────────────────────────────────────────────────────
        const existing = await client.query(
          'SELECT id, team_id FROM scores WHERE session_id = $1 AND player_id = $2 AND match_id IS NULL LIMIT 1',
          [sessionId, playerId]
        );
        if (existing.rows.length === 0) {
          throw Object.assign(new Error('No scores found for this player in this session'), { status: 404 });
        }
        const resolvedTeamId = existing.rows[0].team_id;

        let updatedRow;
        for (let i = 0; i < games_per_session; i++) {
          const r = await client.query(
            `UPDATE scores SET score = $1, recorded_at = CURRENT_TIMESTAMP
             WHERE session_id = $2 AND player_id = $3 AND game_number = $4 AND match_id IS NULL
             RETURNING *`,
            [scores[i], sessionId, playerId, i + 1]
          );
          if (i === 0) updatedRow = r.rows[0];
        }

        // Handicap recalculation handled by DB trigger (trg_recalculate_hdcp)

        const rawTotal = scores.reduce((s, g) => s + g, 0);
        responsePayload = {
          tournamentId,
          sessionId,
          sessionNumber: parseInt(sessionNumber),
          matchId: null,
          playerId,
          scores,
          totalPins: rawTotal,
          sessionAverage: rawTotal / games_per_session,
          recordedAt: updatedRow.recorded_at
        };
      } else {
        // ── Paired format ──────────────────────────────────────────────────
        if (!teamId) {
          throw Object.assign(new Error('teamId is required for paired format tournaments'), { status: 400 });
        }

        const matchResult = await client.query(
          `SELECT m.*, t.games_per_session
           FROM matches m
           JOIN tournaments t ON m.tournament_id = t.id
           WHERE m.session_id = $1 AND (m.home_team_id = $2 OR m.away_team_id = $2)`,
          [sessionId, teamId]
        );
        if (matchResult.rows.length === 0) {
          throw Object.assign(new Error('No match found for this team in the specified session'), { status: 404 });
        }
        const match = matchResult.rows[0];

        const oldResult = await client.query(
          'SELECT game_number, score, team_id FROM scores WHERE match_id = $1 AND player_id = $2 ORDER BY game_number',
          [match.id, playerId]
        );
        if (oldResult.rows.length === 0) {
          throw Object.assign(new Error('No scores found for this player in this match'), { status: 404 });
        }

        const oldTotal = oldResult.rows.reduce((s, r) => s + r.score, 0);
        const newTotal = scores.reduce((s, g) => s + g, 0);
        const delta = newTotal - oldTotal;

        for (let i = 0; i < games_per_session; i++) {
          await client.query(
            `UPDATE scores SET score = $1, recorded_at = CURRENT_TIMESTAMP
             WHERE match_id = $2 AND player_id = $3 AND game_number = $4`,
            [scores[i], match.id, playerId, i + 1]
          );
        }

        // Player statistics handled by DB trigger (trg_recalculate_hdcp)

        await recomputeMatchCompletion(client, match.id, match, games_per_session);

        responsePayload = {
          tournamentId,
          sessionId,
          sessionNumber: parseInt(sessionNumber),
          matchId: match.id,
          playerId,
          teamId,
          scores,
          totalPins: newTotal,
          sessionAverage: newTotal / games_per_session,
        };
      }
    });

    return res.json(responsePayload);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    logger.error('Error updating score:', error);
    res.status(500).json({ error: 'Failed to update score' });
  }
};

// ── DELETE /tournaments/:tournamentId/sessions/:sessionNumber/scores/:playerId

const deleteScore = async (req, res) => {
  const { tournamentId, sessionNumber, playerId } = req.params;
  const { teamId } = req.body;

  try {
    const lookup = await lookupTournamentAndSession(tournamentId, sessionNumber);
    if (lookup.error) return res.status(lookup.status).json({ error: lookup.error });
    const { tournament, sessionId } = lookup;
    const { schedule_type, games_per_session } = tournament;

    await withTransaction(async (client) => {
      if (schedule_type === 'open') {
        // ── Open format ────────────────────────────────────────────────────
        const existing = await client.query(
          'SELECT id, team_id FROM scores WHERE session_id = $1 AND player_id = $2 AND match_id IS NULL LIMIT 1',
          [sessionId, playerId]
        );
        if (existing.rows.length === 0) {
          throw Object.assign(new Error('No scores found for this player in this session'), { status: 404 });
        }
        const resolvedTeamId = existing.rows[0].team_id;

        await client.query(
          'DELETE FROM scores WHERE session_id = $1 AND player_id = $2 AND match_id IS NULL',
          [sessionId, playerId]
        );

        // Handicap recalculation handled by DB trigger (trg_recalculate_hdcp)
      } else {
        // ── Paired format ──────────────────────────────────────────────────
        if (!teamId) {
          throw Object.assign(new Error('teamId is required for paired format tournaments'), { status: 400 });
        }

        const matchResult = await client.query(
          `SELECT m.*
           FROM matches m
           WHERE m.session_id = $1 AND (m.home_team_id = $2 OR m.away_team_id = $2)`,
          [sessionId, teamId]
        );
        if (matchResult.rows.length === 0) {
          throw Object.assign(new Error('No match found for this team in the specified session'), { status: 404 });
        }
        const match = matchResult.rows[0];

        const oldResult = await client.query(
          'SELECT SUM(score) AS total, COUNT(*) AS games FROM scores WHERE match_id = $1 AND player_id = $2',
          [match.id, playerId]
        );
        if (parseInt(oldResult.rows[0].games) === 0) {
          throw Object.assign(new Error('No scores found for this player in this match'), { status: 404 });
        }

        const oldTotal = parseInt(oldResult.rows[0].total);
        const oldGames = parseInt(oldResult.rows[0].games);

        // Player statistics handled by DB trigger (trg_recalculate_hdcp)

        await reverseMatchCompletion(client, match.id, match, games_per_session);

        await client.query(
          'DELETE FROM scores WHERE match_id = $1 AND player_id = $2',
          [match.id, playerId]
        );
      }
    });

    return res.json({ message: 'Scores deleted successfully' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    logger.error('Error deleting score:', error);
    res.status(500).json({ error: 'Failed to delete score' });
  }
};

module.exports = { submitScore, getScores, updateScore, deleteScore };
