// controllers/scoresController.js
// Unified score submission for both 'open' and 'paired' tournament formats.
// Callers never need to know about session_entries vs player_match_scores —
// the controller resolves the right storage based on tournament.schedule_type.
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
    // Fetch tournament and its format
    const tournamentResult = await query(
      'SELECT id, schedule_type FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    const { schedule_type } = tournamentResult.rows[0];

    // Resolve session
    const sessionResult = await query(
      'SELECT id FROM league_sessions WHERE tournament_id = $1 AND session_number = $2',
      [tournamentId, sessionNumber]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const sessionId = sessionResult.rows[0].id;

    // ── Open format ────────────────────────────────────────────────────────────
    if (schedule_type === 'open') {
      const playerResult = await query('SELECT id FROM players WHERE id = $1', [playerId]);
      if (playerResult.rows.length === 0) {
        return res.status(404).json({ error: 'Player not found' });
      }

      // Read current handicap — 0 on first session entry
      const statsResult = await query(
        'SELECT current_handicap FROM player_statistics WHERE player_id = $1 AND tournament_id = $2',
        [playerId, tournamentId]
      );
      const handicapApplied = statsResult.rows.length > 0
        ? statsResult.rows[0].current_handicap
        : 0;

      const result = await query(
        `INSERT INTO session_entries
           (session_id, tournament_id, player_id, team_id,
            game1_score, game2_score, game3_score, handicap_applied)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [sessionId, tournamentId, playerId, teamId || null,
         game1Score, game2Score, game3Score, handicapApplied]
      );

      const entry = result.rows[0];
      return res.status(201).json({
        id: entry.id,
        tournamentId: entry.tournament_id,
        sessionId: entry.session_id,
        sessionNumber,
        playerId: entry.player_id,
        teamId: entry.team_id,
        game1Score: entry.game1_score,
        game2Score: entry.game2_score,
        game3Score: entry.game3_score,
        handicapApplied: entry.handicap_applied,
        totalPins: entry.total_pins,
        sessionAverage: parseFloat(entry.session_average),
        recordedAt: entry.recorded_at
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

      // Verify player exists
      const playerResult = await client.query('SELECT id FROM players WHERE id = $1', [playerId]);
      if (playerResult.rows.length === 0) {
        const err = new Error('Player not found');
        err.status = 404;
        throw err;
      }

      // Reject duplicate
      const existing = await client.query(
        'SELECT id FROM player_match_scores WHERE match_id = $1 AND player_id = $2',
        [match.id, playerId]
      );
      if (existing.rows.length > 0) {
        const err = new Error('Score already recorded for this player in this session');
        err.status = 400;
        throw err;
      }

      // Insert into player_match_scores
      const scoreResult = await client.query(
        `INSERT INTO player_match_scores
           (match_id, team_id, player_id, game1_score, game2_score, game3_score, handicap_applied)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [match.id, teamId, playerId, game1Score, game2Score, game3Score, 0]
      );

      // Update lifetime player stats
      const totalScore = game1Score + game2Score + game3Score;
      await client.query(
        `UPDATE players
         SET total_games_played = total_games_played + 3,
             total_pins         = total_pins + $1,
             average_score      = CASE
               WHEN total_games_played + 3 > 0
               THEN ROUND((total_pins + $1)::DECIMAL / (total_games_played + 3), 2)
               ELSE 0
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [totalScore, playerId]
      );

      const score = scoreResult.rows[0];
      responsePayload = {
        id: score.id,
        tournamentId,
        sessionId,
        sessionNumber,
        matchId: match.id,
        playerId: score.player_id,
        teamId: score.team_id,
        game1Score: score.game1_score,
        game2Score: score.game2_score,
        game3Score: score.game3_score,
        handicapApplied: score.handicap_applied,
        recordedAt: score.created_at
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
        `SELECT se.*,
                p.name AS player_name,
                t.name AS team_name
         FROM   session_entries se
         JOIN   league_sessions ls ON se.session_id  = ls.id
         JOIN   players          p  ON se.player_id   = p.id
         LEFT JOIN teams         t  ON se.team_id     = t.id
         WHERE  se.tournament_id  = $1
           AND  ls.session_number = $2
         ORDER BY se.total_pins DESC`,
        [tournamentId, session]
      );

      return res.json(result.rows.map(row => ({
        id: row.id,
        tournamentId: row.tournament_id,
        sessionId: row.session_id,
        sessionNumber: parseInt(session),
        playerId: row.player_id,
        playerName: row.player_name,
        teamId: row.team_id,
        teamName: row.team_name,
        game1Score: row.game1_score,
        game2Score: row.game2_score,
        game3Score: row.game3_score,
        handicapApplied: row.handicap_applied,
        totalPins: row.total_pins,
        sessionAverage: parseFloat(row.session_average),
        recordedAt: row.recorded_at
      })));
    }

    // ── Paired format ──────────────────────────────────────────────────────────
    const result = await query(
      `SELECT pms.*,
              p.name  AS player_name,
              t.name  AS team_name,
              m.id    AS match_id,
              ls.session_number
       FROM   player_match_scores pms
       JOIN   matches        m  ON pms.match_id  = m.id
       JOIN   league_sessions ls ON m.session_id = ls.id
       JOIN   players         p  ON pms.player_id = p.id
       JOIN   teams           t  ON pms.team_id   = t.id
       WHERE  m.tournament_id   = $1
         AND  ls.session_number = $2
       ORDER BY t.name, p.name`,
      [tournamentId, session]
    );

    return res.json(result.rows.map(row => ({
      id: row.id,
      tournamentId,
      sessionId: row.session_id,
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
      recordedAt: row.created_at
    })));
  } catch (error) {
    logger.error('Error fetching scores:', error);
    res.status(500).json({ error: 'Failed to fetch scores' });
  }
};

module.exports = { submitScore, getScores };
