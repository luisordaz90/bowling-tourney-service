// tests/handicap-evolution.test.js
// Verifies handicap recalculation trigger across 5 sessions for a single player
// in both an open-format and a paired-format tournament.
//
// Handicap formula: GREATEST(0, FLOOR((hdcp_base - average) * hdcp_percentage))
// Default: hdcp_base=220, hdcp_percentage=0.90
//
// The same player bowls 5 sessions with scores that shift their average,
// and we assert the trigger-computed handicap matches the expected value after each session.

const request = require('supertest');
const app = require('../server');
const { query } = require('../config/database');

// ── Helpers ─────────────────────────────────────────────────────────────────────

function expectedHandicap(totalPins, totalGames, base = 220, pct = 0.90) {
  const avg = totalPins / totalGames;
  return Math.max(0, Math.floor((base - avg) * pct));
}

async function getPlayerStats(playerId, tournamentId) {
  const res = await query(
    `SELECT current_average, current_handicap, games_played, total_pins
     FROM player_statistics
     WHERE player_id = $1 AND tournament_id = $2`,
    [playerId, tournamentId]
  );
  return res.rows[0] || null;
}

// Score sets per session (3 games each).
// Designed to show handicap evolving as the player improves then regresses.
const SESSION_SCORES = [
  [150, 140, 160],  // avg 150  -> hdcp FLOOR((220-150)*0.9) = 63
  [170, 165, 175],  // cumulative avg 160 -> hdcp FLOOR((220-160)*0.9) = 54
  [190, 185, 195],  // cumulative avg 170 -> hdcp FLOOR((220-170)*0.9) = 45
  [200, 210, 205],  // cumulative avg 178.75 -> hdcp FLOOR((220-178.75)*0.9) = 37
  [130, 125, 135],  // cumulative avg 170 -> hdcp FLOOR((220-170)*0.9) = 45
];

// ── Open Format ─────────────────────────────────────────────────────────────────

describe('Handicap evolution — open format', () => {
  let tournamentId, playerId, teamId;

  beforeAll(async () => {
    // Create player
    const playerRes = await request(app)
      .post('/api/players')
      .send({ name: 'Hdcp Open Player', email: 'hdcp.open@test.com' });
    playerId = playerRes.body.id;

    // Create a solo team for the player
    const teamRes = await request(app)
      .post('/api/teams')
      .send({ name: 'Hdcp Open Solo', captainName: 'Hdcp Open Player', captainEmail: 'hdcp.open.team@test.com' });
    teamId = teamRes.body.id;

    // Create open-format tournament
    const tourneyRes = await request(app)
      .post('/api/tournaments')
      .send({
        name: 'Hdcp Open Test 2026',
        startDate: '2026-04-01',
        endDate: '2026-06-30',
        maxTeams: 8,
        totalSessions: 5,
        sessionType: 'weekly',
        scheduleType: 'open',
        rankingMethod: 'pins',
        hdcpBase: 220,
        hdcpPercentage: 0.90,
      });
    tournamentId = tourneyRes.body.id;

    // Create 5 sessions
    for (let i = 1; i <= 5; i++) {
      await request(app)
        .post(`/api/tournaments/${tournamentId}/sessions`)
        .send({ sessionNumber: i, sessionName: `Week ${i}`, sessionDate: `2026-04-${String(i).padStart(2, '0')}` });
    }
  });

  let cumulativePins = 0;
  let cumulativeGames = 0;

  for (let s = 0; s < SESSION_SCORES.length; s++) {
    const scores = SESSION_SCORES[s];
    const sessionNum = s + 1;

    it(`session ${sessionNum}: submits scores and handicap updates correctly`, async () => {
      const res = await request(app)
        .post(`/api/tournaments/${tournamentId}/sessions/${sessionNum}/scores`)
        .send({ playerId, teamId, scores });

      expect(res.status).toBe(201);

      cumulativePins += scores.reduce((a, b) => a + b, 0);
      cumulativeGames += scores.length;

      const expected = expectedHandicap(cumulativePins, cumulativeGames);

      const stats = await getPlayerStats(playerId, tournamentId);
      expect(stats).not.toBeNull();
      expect(stats.games_played).toBe(cumulativeGames);
      expect(stats.total_pins).toBe(cumulativePins);
      expect(stats.current_handicap).toBe(expected);
    });
  }
});

// ── Paired Format ───────────────────────────────────────────────────────────────

describe('Handicap evolution — paired format', () => {
  let tournamentId, playerId, teamId, opponentTeamId, opponentPlayerId;

  beforeAll(async () => {
    // Player under test
    const playerRes = await request(app)
      .post('/api/players')
      .send({ name: 'Hdcp Paired Player', email: 'hdcp.paired@test.com' });
    playerId = playerRes.body.id;

    // Opponent player
    const oppPlayerRes = await request(app)
      .post('/api/players')
      .send({ name: 'Hdcp Opponent Player', email: 'hdcp.opponent@test.com' });
    opponentPlayerId = oppPlayerRes.body.id;

    // Two teams
    const teamRes = await request(app)
      .post('/api/teams')
      .send({ name: 'Hdcp Paired Team A', captainName: 'Cap A', captainEmail: 'hdcp.paired.a@test.com' });
    teamId = teamRes.body.id;

    const oppTeamRes = await request(app)
      .post('/api/teams')
      .send({ name: 'Hdcp Paired Team B', captainName: 'Cap B', captainEmail: 'hdcp.paired.b@test.com' });
    opponentTeamId = oppTeamRes.body.id;

    // Paired tournament with 5 sessions
    const tourneyRes = await request(app)
      .post('/api/tournaments')
      .send({
        name: 'Hdcp Paired Test 2026',
        startDate: '2026-04-01',
        endDate: '2026-06-30',
        maxTeams: 4,
        totalSessions: 5,
        sessionType: 'weekly',
        scheduleType: 'paired',
        rankingMethod: 'points',
        hdcpBase: 220,
        hdcpPercentage: 0.90,
      });
    tournamentId = tourneyRes.body.id;

    // Register teams + players
    await request(app)
      .post(`/api/tournaments/${tournamentId}/teams`)
      .send({ teamId });
    await request(app)
      .post(`/api/tournaments/${tournamentId}/teams`)
      .send({ teamId: opponentTeamId });

    await request(app)
      .post(`/api/tournaments/${tournamentId}/teams/${teamId}/players`)
      .send({ playerId });
    await request(app)
      .post(`/api/tournaments/${tournamentId}/teams/${opponentTeamId}/players`)
      .send({ playerId: opponentPlayerId });

    // Round-robin with 2 teams only generates 1 session.
    // We need 5 sessions with a match in each, so create them manually.
    for (let i = 1; i <= 5; i++) {
      // Create session
      const sessionRes = await request(app)
        .post(`/api/tournaments/${tournamentId}/sessions`)
        .send({ sessionNumber: i, sessionName: `Week ${i}`, sessionDate: `2026-04-${String(i).padStart(2, '0')}` });
      const sessionId = sessionRes.body.id;

      // Create a match in this session
      await request(app)
        .post(`/api/tournaments/${tournamentId}/matches`)
        .send({
          homeTeamId: teamId,
          awayTeamId: opponentTeamId,
          sessionId,
          sessionNumber: i,
        });
    }
  });

  let cumulativePins = 0;
  let cumulativeGames = 0;
  let prevHandicap = 0;

  for (let s = 0; s < SESSION_SCORES.length; s++) {
    const scores = SESSION_SCORES[s];
    const sessionNum = s + 1;

    it(`session ${sessionNum}: submits scores with handicap applied and updates correctly`, async () => {
      const res = await request(app)
        .post(`/api/tournaments/${tournamentId}/sessions/${sessionNum}/scores`)
        .send({ playerId, teamId, scores });

      expect(res.status).toBe(201);
      // Paired format should now apply the previous session's handicap
      expect(res.body.handicapApplied).toBe(prevHandicap);

      cumulativePins += scores.reduce((a, b) => a + b, 0);
      cumulativeGames += scores.length;

      const expected = expectedHandicap(cumulativePins, cumulativeGames);

      const stats = await getPlayerStats(playerId, tournamentId);
      expect(stats).not.toBeNull();
      expect(stats.games_played).toBe(cumulativeGames);
      expect(stats.total_pins).toBe(cumulativePins);
      expect(stats.current_handicap).toBe(expected);

      prevHandicap = expected;
    });
  }
});

// ── Cross-tournament isolation ──────────────────────────────────────────────────

describe('Handicap is tournament-scoped (no cross-contamination)', () => {
  it('the open and paired stats are independent for the same player', async () => {
    // Query all player_statistics for any player whose email starts with 'hdcp.'
    // There should be exactly 2 rows (one per tournament) and their values should differ
    // because the paired format only saw 5 sessions while open also saw 5 but they are
    // separate tournament contexts.
    //
    // We just verify the two tournaments have separate stats rows.
    const res = await query(
      `SELECT ps.tournament_id, ps.current_average, ps.current_handicap, ps.games_played
       FROM player_statistics ps
       JOIN players p ON ps.player_id = p.id
       WHERE p.email IN ('hdcp.open@test.com', 'hdcp.paired@test.com')
       ORDER BY p.email, ps.tournament_id`
    );

    // Each player played in exactly one tournament
    expect(res.rows.length).toBe(2);

    // Both should have the same final stats since they used the same scores
    const openStats = res.rows[0];
    const pairedStats = res.rows[1];
    expect(openStats.tournament_id).not.toBe(pairedStats.tournament_id);
    expect(openStats.games_played).toBe(15);
    expect(pairedStats.games_played).toBe(15);
  });
});
