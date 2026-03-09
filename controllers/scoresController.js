// controllers/scoresController.js
// Unified score submission for both 'open' and 'paired' tournament formats.
// Internally stores one row per game in the `scores` table.
// Callers never need to know about the underlying per-game storage —
// they still submit all game scores in one request and receive session-level aggregates.
const { query, withTransaction } = require('../config/database');
const logger = require('../config/logger');
const { validateScore } = require('../utils/helpers');

const submitScore = async (req, res) => {
  const { tournamentId } = req.params;
  const { sessionNumber, playerId, teamId, game1Score, game2Score, game3Score } = req.body;

  if (!sessionNumber || !playerId || game1Score == null || game2Score == null || game3Score == null) {
    return res.status(400).json({ error: 'sessionNumber, playerId, game1Score, game2Score, and game3Score are required' });
  }

  if (!validateScore(game1Score) || !validateScore(game2Score) || !validateScore(game3Score)) {
    return res.status(400).json({ error: 'Scores must be between 0 and 300' });
  }

  try {
    const tournamentResult = await query(
      'SELECT id, schedule_type, games_per_session FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    const { schedule_type, games_per_session } = tournamentResult.rows[0];

    const sessionResult = await query(
      'SELECT id FROM league_sessions WHERE tournament_id = $1 AND session_number = $2',
      [tournamentId, sessionNumber]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const sessionId = sessionResult.rows[0].id;

    const gameScores = [game1Score, game2Score, game3Score].slice(0, games_per_session);

    // ── Open format ────────────────────────────────────────────────────────────
    if (schedule_type === 'open') {
      const playerResult = await query('SELECT id FROM players WHERE id = $1', [playerId]);
      if (playerResult.rows.length === 0) {
        return res.status(404).json({ error: 'Player not found' });
      }

      // Reject duplicate (any game row already recorded for this player/session)
      const existingResult = await query(
        'SELECT id FROM scores WHERE session_id = $1 AND player_id = $2 AND match_id IS NULL LIMIT 1',
        [sessionId, playerId]
      );
      if (existingResult.rows.length > 0) {
        return res.status(400).json({ error: 'Score already recorded for this player in this session' });
      }

      // Read current handicap — 0 on first session entry
      const statsResult = await query(
        'SELECT current_handicap FROM player_statistics WHERE player_id = $1 AND tournament_id = $2',
        [playerId, tournamentId]
      );
      const handicapApplied = statsResult.rows.length > 0
        ? statsResult.rows[0].current_handicap
        : 0;

      // Insert one row per game inside a transaction
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
             i + 1, gameScores[i], handicapApplied]
          );
          if (i === 0) firstRow = r.rows[0];
        }
      });

      const rawTotal = gameScores.reduce((s, g) => s + g, 0);
      const totalPins = rawTotal + handicapApplied * games_per_session;

      return res.status(201).json({
        id: firstRow.id,
        tournamentId,
        sessionId,
        sessionNumber,
        playerId,
        teamId: teamId || null,
        game1Score,
        game2Score,
        game3Score,
        handicapApplied,
        totalPins,
        sessionAverage: rawTotal / games_per_session,
        recordedAt: firstRow.recorded_at
      });
    }

    // ── Paired format ──────────────────────────────────────────────────────────
    if (!teamId) {
      return res.status(400).json({ error: 'teamId is required for paired format tournaments' });
    }

    let responsePayload;

    await withTransaction(async (client) => {
      // Auto-resolve the match for this team in this session
      const matchResult = await client.query(
        `SELECT id, home_team_id, away_team_id
         FROM matches
         WHERE session_id = $1
           AND (home_team_id = $2 OR away_team_id = $2)`,
        [sessionId, teamId]
      );
      if (matchResult.rows.length === 0) {
        const err = new Error('No match found for this team in the specified session');
        err.status = 404;
        throw err;
      }
      const match = matchResult.rows[0];

      const playerResult = await client.query('SELECT id FROM players WHERE id = $1', [playerId]);
      if (playerResult.rows.length === 0) {
        const err = new Error('Player not found');
        err.status = 404;
        throw err;
      }

      // Reject duplicate
      const existing = await client.query(
        'SELECT id FROM scores WHERE match_id = $1 AND player_id = $2 AND match_id IS NOT NULL LIMIT 1',
        [match.id, playerId]
      );
      if (existing.rows.length > 0) {
        const err = new Error('Score already recorded for this player in this session');
        err.status = 400;
        throw err;
      }

      // Insert one row per game
      let firstRow;
      for (let i = 0; i < games_per_session; i++) {
        const r = await client.query(
          `INSERT INTO scores
             (session_id, tournament_id, player_id, team_id, match_id,
              game_number, score, handicap_applied)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [sessionId, tournamentId, playerId, teamId, match.id,
           i + 1, gameScores[i], 0]
        );
        if (i === 0) firstRow = r.rows[0];
      }

      // Update lifetime player stats
      const totalScore = gameScores.reduce((s, g) => s + g, 0);
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
        [games_per_session, totalScore, playerId]
      );

      responsePayload = {
        id: firstRow.id,
        tournamentId,
        sessionId,
        sessionNumber,
        matchId: match.id,
        playerId,
        teamId,
        game1Score,
        game2Score,
        game3Score,
        handicapApplied: 0,
        recordedAt: firstRow.recorded_at
      };
    });

    return res.status(201).json(responsePayload);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Score already recorded for this player in this session' });
    }
    logger.error('Error submitting score:', error);
    res.status(500).json({ error: 'Failed to submit score' });
  }
};

const getScores = async (req, res) => {
  const { tournamentId } = req.params;
  const { session } = req.query;

  if (!session) {
    return res.status(400).json({ error: 'session query parameter is required' });
  }

  try {
    const tournamentResult = await query(
      'SELECT id, schedule_type FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    const { schedule_type } = tournamentResult.rows[0];

    // ── Open format ────────────────────────────────────────────────────────────
    if (schedule_type === 'open') {
      const result = await query(
        `SELECT
           s.player_id,
           p.name                                               AS player_name,
           s.team_id,
           t.name                                               AS team_name,
           MAX(CASE WHEN s.game_number = 1 THEN s.score END)   AS game1_score,
           MAX(CASE WHEN s.game_number = 2 THEN s.score END)   AS game2_score,
           MAX(CASE WHEN s.game_number = 3 THEN s.score END)   AS game3_score,
           MAX(s.handicap_applied)                             AS handicap_applied,
           SUM(s.pins_with_hdcp)                               AS total_pins,
           ROUND(SUM(s.score)::DECIMAL / COUNT(*), 2)          AS session_average,
           MIN(s.recorded_at)                                  AS recorded_at
         FROM   scores s
         JOIN   league_sessions ls ON s.session_id  = ls.id
         JOIN   players          p  ON s.player_id  = p.id
         LEFT JOIN teams         t  ON s.team_id    = t.id
         WHERE  s.tournament_id  = $1
           AND  ls.session_number = $2
           AND  s.match_id IS NULL
         GROUP BY s.player_id, p.name, s.team_id, t.name
         ORDER BY total_pins DESC`,
        [tournamentId, session]
      );

      return res.json(result.rows.map(row => ({
        tournamentId,
        sessionNumber: parseInt(session),
        playerId: row.player_id,
        playerName: row.player_name,
        teamId: row.team_id,
        teamName: row.team_name,
        game1Score: row.game1_score,
        game2Score: row.game2_score,
        game3Score: row.game3_score,
        handicapApplied: row.handicap_applied,
        totalPins: parseInt(row.total_pins),
        sessionAverage: parseFloat(row.session_average),
        recordedAt: row.recorded_at
      })));
    }

    // ── Paired format ──────────────────────────────────────────────────────────
    const result = await query(
      `SELECT
         s.player_id,
         p.name                                               AS player_name,
         s.team_id,
         t.name                                               AS team_name,
         s.match_id,
         MAX(CASE WHEN s.game_number = 1 THEN s.score END)   AS game1_score,
         MAX(CASE WHEN s.game_number = 2 THEN s.score END)   AS game2_score,
         MAX(CASE WHEN s.game_number = 3 THEN s.score END)   AS game3_score,
         MAX(s.handicap_applied)                             AS handicap_applied,
         MIN(s.recorded_at)                                  AS recorded_at
       FROM   scores s
       JOIN   league_sessions ls ON s.session_id  = ls.id
       JOIN   players          p  ON s.player_id  = p.id
       JOIN   teams             t  ON s.team_id   = t.id
       WHERE  s.tournament_id   = $1
         AND  ls.session_number = $2
         AND  s.match_id IS NOT NULL
       GROUP BY s.player_id, p.name, s.team_id, t.name, s.match_id
       ORDER BY t.name, p.name`,
      [tournamentId, session]
    );

    return res.json(result.rows.map(row => ({
      tournamentId,
      sessionNumber: parseInt(session),
      matchId: row.match_id,
      playerId: row.player_id,
      playerName: row.player_name,
      teamId: row.team_id,
      teamName: row.team_name,
      game1Score: row.game1_score,
      game2Score: row.game2_score,
      game3Score: row.game3_score,
      handicapApplied: row.handicap_applied,
      recordedAt: row.recorded_at
    })));
  } catch (error) {
    logger.error('Error fetching scores:', error);
    res.status(500).json({ error: 'Failed to fetch scores' });
  }
};

module.exports = { submitScore, getScores };
