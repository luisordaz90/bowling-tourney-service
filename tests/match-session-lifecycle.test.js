// tests/match-session-lifecycle.test.js
// Tests automatic match/session lifecycle transitions and captain-based score submission.
//
// Scenarios:
//  1. Captain submits scores → 201
//  2. Regular player submits scores → 403
//  3. Admin submits scores (bypasses captain check) → 201
//  4. Score for player not on roster → 400
//  5. First score → match becomes 'in_progress'
//  6. All scores for both teams → match 'completed', match_points populated, team_statistics updated, winner set
//  7. Partial scores (one team done) → match stays 'in_progress'
//  8. First match in_progress → session becomes 'active'
//  9. All matches completed → session becomes 'completed'
// 10. Cancelled session stays cancelled despite score submissions

const request = require('supertest');
const app = require('../server');
const { query, closePool } = require('../config/database');

afterAll(async () => {
  await closePool();
});

// ── Shared state ─────────────────────────────────────────────────────────────

const ids = {};

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Create league
  const leagueRes = await request(app)
    .post('/api/leagues')
    .set('X-User-Role', 'superadmin')
    .send({ name: 'Lifecycle Test League', location: 'Test Alley' });
  ids.league = leagueRes.body.id;

  // Create tournament: 4 teams × 3 players, 3 games/session, paired format
  // 4 teams gives 3 round-robin rounds → 3 sessions with 2 matches each
  const tourneyRes = await request(app)
    .post('/api/tournaments')
    .set('X-User-Role', 'superadmin')
    .send({
      leagueId: ids.league,
      name: 'Lifecycle Tournament',
      startDate: '2026-12-01',
      endDate: '2027-02-28',
      maxTeams: 4,
      totalSessions: 3,
      sessionType: 'paired',
      gamesPerSession: 3,
      basisScore: 220,
      handicapPercentage: 90,
    });
  ids.tournament = tourneyRes.body.id;

  // Create 4 teams with 3 players each
  ids.teams = [];
  ids.players = [];
  ids.captains = [];

  for (let t = 0; t < 4; t++) {
    const teamRes = await request(app)
      .post('/api/teams')
      .send({ name: `LC Team ${t + 1}`, captainName: `LCCap${t}`, captainEmail: `lc-cap${t}@test.com` });
    ids.teams.push(teamRes.body.id);

    await request(app).post('/api/registrations/teams').send({
      tournamentId: ids.tournament,
      teamId: teamRes.body.id,
    });

    const teamPlayers = [];
    for (let p = 0; p < 3; p++) {
      const pRes = await request(app)
        .post('/api/players')
        .send({ name: `LC-P${t}-${p}`, email: `lc-p${t}${p}@test.com` });
      teamPlayers.push(pRes.body.id);

      await request(app).post('/api/registrations/players').send({
        tournamentId: ids.tournament,
        teamId: teamRes.body.id,
        playerId: pRes.body.id,
        role: p === 0 ? 'captain' : 'regular',
      });
    }
    ids.players.push(teamPlayers);
    ids.captains.push(teamPlayers[0]);
  }

  // Generate schedule
  await request(app)
    .post('/api/schedule/generate')
    .set('X-User-Role', 'superadmin')
    .send({ tournamentId: ids.tournament });

  // Fetch sessions
  const sessionsRes = await request(app).get(`/api/tournaments/${ids.tournament}/sessions`);
  ids.sessions = sessionsRes.body.map(s => ({ id: s.id, sessionNumber: parseInt(s.sessionNumber) }));

  // Fetch all matches for the tournament
  const allMatchesRes = await request(app)
    .get(`/api/tournaments/${ids.tournament}/matches`);

  // Group by session number
  ids.matchesBySession = {};
  const matches = allMatchesRes.body.matches || allMatchesRes.body;
  if (Array.isArray(matches)) {
    for (const m of matches) {
      const sn = parseInt(m.sessionNumber);
      if (!ids.matchesBySession[sn]) ids.matchesBySession[sn] = [];
      ids.matchesBySession[sn].push({
        id: m.id,
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
      });
    }
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function submitScore(playerId, teamId, scores, headers = {}) {
  const sessionNumber = 1;
  let req = request(app)
    .post('/api/scores')
    .send({
      tournamentId: ids.tournament,
      sessionNumber,
      playerId,
      teamId,
      scores,
    });
  for (const [k, v] of Object.entries(headers)) {
    req = req.set(k, v);
  }
  return req;
}

async function getMatchStatus(matchId) {
  const result = await query('SELECT status, winner_team_id FROM matches WHERE id = $1', [matchId]);
  return result.rows[0];
}

async function getSessionStatus(sessionId) {
  const result = await query('SELECT status FROM tournament_sessions WHERE id = $1', [sessionId]);
  return result.rows[0].status;
}

async function getMatchPoints(matchId) {
  const result = await query('SELECT * FROM match_points WHERE match_id = $1', [matchId]);
  return result.rows[0] || null;
}

async function getTeamStats(teamId, tournamentId) {
  const result = await query(
    'SELECT * FROM team_statistics WHERE team_id = $1 AND tournament_id = $2',
    [teamId, tournamentId]
  );
  return result.rows[0] || null;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Captain score submission auth', () => {
  // Use session 1's first match — resolve the actual home/away teams
  function s1Match() { return ids.matchesBySession[1][0]; }
  function homeIdx() { return ids.teams.indexOf(s1Match().homeTeamId); }
  function awayIdx() { return ids.teams.indexOf(s1Match().awayTeamId); }

  it('captain submits scores → 201', async () => {
    const ti = homeIdx();
    const captainId = ids.captains[ti];
    const playerId = ids.players[ti][1]; // regular player on home team

    const res = await submitScore(playerId, ids.teams[ti], [180, 190, 185], {
      'X-User-Role': 'player',
      'X-Player-Id': captainId,
    });
    expect(res.status).toBe(201);
  });

  it('regular player submits scores → 403', async () => {
    const ti = homeIdx();
    const regularId = ids.players[ti][1]; // regular member
    const playerId = ids.players[ti][2];

    const res = await submitScore(playerId, ids.teams[ti], [170, 160, 165], {
      'X-User-Role': 'player',
      'X-Player-Id': regularId,
    });
    expect(res.status).toBe(403);
  });

  it('admin submits scores (bypasses captain check) → 201', async () => {
    const ti = homeIdx();
    const playerId = ids.players[ti][2];

    const res = await submitScore(playerId, ids.teams[ti], [200, 195, 205], {
      'X-User-Role': 'superadmin',
    });
    expect(res.status).toBe(201);
  });

  it('score for player not on roster → 400', async () => {
    const ti = homeIdx();
    const otherTi = awayIdx();
    const captainId = ids.captains[ti];
    const otherTeamPlayer = ids.players[otherTi][0];

    const res = await submitScore(otherTeamPlayer, ids.teams[ti], [180, 190, 185], {
      'X-User-Role': 'player',
      'X-Player-Id': captainId,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not an active member/i);
  });
});

describe('Match lifecycle transitions', () => {
  // Use session 2 for clean lifecycle tests (session 1 already has partial scores from auth tests)
  let match;
  let sessionId;

  beforeAll(() => {
    // Use session 2 — session 1 has partial scores from auth tests
    const sn = 2;
    match = ids.matchesBySession[sn]?.[0];
    sessionId = ids.sessions.find(s => s.sessionNumber === sn)?.id;
    if (!match) throw new Error(`No matches found for session ${sn}. Available: ${JSON.stringify(ids.matchesBySession)}`);
  });

  it('match starts as scheduled', async () => {
    const status = await getMatchStatus(match.id);
    expect(status.status).toBe('scheduled');
  });

  // Helper: get the player array index for a given teamId
  function teamIdx(teamId) {
    return ids.teams.indexOf(teamId);
  }

  it('first score → match becomes in_progress', async () => {
    const ti = teamIdx(match.homeTeamId);
    const res = await request(app)
      .post('/api/scores')
      .set('X-User-Role', 'superadmin')
      .send({
        tournamentId: ids.tournament,
        sessionNumber: 2,
        playerId: ids.players[ti][0],
        teamId: match.homeTeamId,
        scores: [200, 210, 195],
      });
    expect(res.status).toBe(201);

    const status = await getMatchStatus(match.id);
    expect(status.status).toBe('in_progress');
  });

  it('session becomes active when first match is in_progress', async () => {
    const status = await getSessionStatus(sessionId);
    expect(status).toBe('active');
  });

  it('partial scores (one team done) → match stays in_progress', async () => {
    const ti = teamIdx(match.homeTeamId);
    for (let p = 1; p < 3; p++) {
      const res = await request(app)
        .post('/api/scores')
        .set('X-User-Role', 'superadmin')
        .send({
          tournamentId: ids.tournament,
          sessionNumber: 2,
          playerId: ids.players[ti][p],
          teamId: match.homeTeamId,
          scores: [180 + p * 5, 185 + p * 5, 175 + p * 5],
        });
      expect(res.status).toBe(201);
    }

    const status = await getMatchStatus(match.id);
    expect(status.status).toBe('in_progress');
  });

  it('all scores for both teams → match completed with points and stats', async () => {
    const ti = teamIdx(match.awayTeamId);
    for (let p = 0; p < 3; p++) {
      const res = await request(app)
        .post('/api/scores')
        .set('X-User-Role', 'superadmin')
        .send({
          tournamentId: ids.tournament,
          sessionNumber: 2,
          playerId: ids.players[ti][p],
          teamId: match.awayTeamId,
          scores: [170 + p * 3, 175 + p * 3, 165 + p * 3],
        });
      expect(res.status).toBe(201);
      if (p === 2) {
        expect(res.body.matchCompleted).toBe(true);
      }
    }

    const status = await getMatchStatus(match.id);
    expect(status.status).toBe('completed');
    expect(status.winner_team_id).not.toBeNull();

    const points = await getMatchPoints(match.id);
    expect(points).not.toBeNull();
    expect(points.home_total_points).toBeDefined();
    expect(points.away_total_points).toBeDefined();

    const homeStats = await getTeamStats(match.homeTeamId, ids.tournament);
    expect(homeStats).not.toBeNull();
    expect(homeStats.total_matches_played).toBeGreaterThanOrEqual(1);

    const awayStats = await getTeamStats(match.awayTeamId, ids.tournament);
    expect(awayStats).not.toBeNull();
    expect(awayStats.total_matches_played).toBeGreaterThanOrEqual(1);
  });

  it('all matches completed → session becomes completed', async () => {
    const sn = 2;
    const remainingMatches = ids.matchesBySession[sn].filter(m => m.id !== match.id);
    for (const rm of remainingMatches) {
      for (const side of ['homeTeamId', 'awayTeamId']) {
        const ti = teamIdx(rm[side]);
        for (let p = 0; p < 3; p++) {
          await request(app)
            .post('/api/scores')
            .set('X-User-Role', 'superadmin')
            .send({
              tournamentId: ids.tournament,
              sessionNumber: sn,
              playerId: ids.players[ti][p],
              teamId: rm[side],
              scores: [180 + p * 2, 185 + p * 2, 175 + p * 2],
            });
        }
      }
    }

    const status = await getSessionStatus(sessionId);
    expect(status).toBe('completed');
  });
});

describe('Cancelled session stays cancelled', () => {
  it('does not override cancelled status on score submission', async () => {
    const sn = 3;
    const sessionId = ids.sessions.find(s => s.sessionNumber === sn)?.id;
    if (!sessionId) return; // skip if session doesn't exist
    const match = ids.matchesBySession[sn]?.[0];
    if (!match) return; // skip if no session 3

    // Manually cancel the session
    await query("UPDATE tournament_sessions SET status = 'cancelled' WHERE id = $1", [sessionId]);

    // Submit a score
    const ti = ids.teams.indexOf(match.homeTeamId);
    await request(app)
      .post('/api/scores')
      .set('X-User-Role', 'superadmin')
      .send({
        tournamentId: ids.tournament,
        sessionNumber: sn,
        playerId: ids.players[ti][0],
        teamId: match.homeTeamId,
        scores: [200, 210, 195],
      });

    // Session should still be cancelled
    const status = await getSessionStatus(sessionId);
    expect(status).toBe('cancelled');
  });
});
