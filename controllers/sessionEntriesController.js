// controllers/sessionEntriesController.js
const { query } = require('../config/database');
const logger = require('../config/logger');
const { validateScore } = require('../utils/helpers');

const createSessionEntry = async (req, res) => {
  const { tournamentId, sessionNumber } = req.params;
  const { playerId, teamId, game1Score, game2Score, game3Score } = req.body;

  if (!playerId || game1Score == null || game2Score == null || game3Score == null) {
    return res.status(400).json({ error: 'playerId, game1Score, game2Score, and game3Score are required' });
  }

  if (!validateScore(game1Score) || !validateScore(game2Score) || !validateScore(game3Score)) {
    return res.status(400).json({ error: 'Scores must be between 0 and 300' });
  }

  try {
    // Verify tournament exists and is open format
    const tournamentResult = await query(
      'SELECT id, schedule_type FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    if (tournamentResult.rows[0].schedule_type !== 'open') {
      return res.status(400).json({ error: 'Session entries are only valid for open format tournaments' });
    }

    // Resolve session by tournament + session_number
    const sessionResult = await query(
      'SELECT id FROM league_sessions WHERE tournament_id = $1 AND session_number = $2',
      [tournamentId, sessionNumber]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const sessionId = sessionResult.rows[0].id;

    // Verify player exists
    const playerResult = await query('SELECT id FROM players WHERE id = $1', [playerId]);
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Read current handicap from player_statistics for this tournament.
    // Defaults to 0 if no prior session entry exists (first session in tournament).
    const statsResult = await query(
      `SELECT current_handicap FROM player_statistics
       WHERE player_id = $1 AND tournament_id = $2`,
      [playerId, tournamentId]
    );
    const handicapApplied = statsResult.rows.length > 0
      ? statsResult.rows[0].current_handicap
      : 0;

    // Insert the entry — trg_recalculate_hdcp fires after this and upserts player_statistics
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
    res.status(201).json({
      id: entry.id,
      sessionId: entry.session_id,
      tournamentId: entry.tournament_id,
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
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Entry already exists for this player in this session' });
    }
    logger.error('Error creating session entry:', error);
    res.status(500).json({ error: 'Failed to create session entry' });
  }
};

const getSessionEntries = async (req, res) => {
  const { tournamentId, sessionNumber } = req.params;

  try {
    // Verify tournament exists
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const result = await query(
      `SELECT se.*,
              p.name  AS player_name,
              t.name  AS team_name
       FROM   session_entries se
       JOIN   league_sessions ls ON se.session_id  = ls.id
       JOIN   players          p  ON se.player_id   = p.id
       LEFT JOIN teams         t  ON se.team_id     = t.id
       WHERE  se.tournament_id  = $1
         AND  ls.session_number = $2
       ORDER BY se.total_pins DESC`,
      [tournamentId, sessionNumber]
    );

    const entries = result.rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      tournamentId: row.tournament_id,
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
    }));

    res.json(entries);
  } catch (error) {
    logger.error('Error fetching session entries:', error);
    res.status(500).json({ error: 'Failed to fetch session entries' });
  }
};

module.exports = { createSessionEntry, getSessionEntries };
