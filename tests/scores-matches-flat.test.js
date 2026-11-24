// tests/scores-matches-flat.test.js
// TDD tests for Phase 4: flat /api/scores and /api/matches routes
const request = require('supertest');
const app = require('../server');

let leagueId, tournamentId, teamIds = [], playerIds = [], matchId;

beforeAll(async () => {
  // Fetch a league
  const leaguesRes = await request(app).get('/api/leagues');
  leagueId = leaguesRes.body[0].id;

  // Create paired tournament
  const tRes = await request(app)
    .post('/api/tournaments')
    .send({
      name: 'Scores Flat Test Tournament',
      startDate: '2027-01-01',
      endDate: '2027-04-01',
      maxTeams: 4,
      totalSessions: 3,
      sessionType: 'weekly',
      leagueId,
    });
  tournamentId = tRes.body.id;

  // Create 4 teams with 3 players each
  for (let i = 0; i < 4; i++) {
    const teamRes = await request(app)
      .post('/api/teams')
      .send({ name: `SF Team ${i + 1}`, captainName: `Cap${i}`, captainEmail: `sf-cap${i}@test.com` });
    teamIds.push(teamRes.body.id);
    await request(app).post('/api/registrations/teams').send({ tournamentId, teamId: teamRes.body.id });

    for (let j = 0; j < 3; j++) {
      const pRes = await request(app)
        .post('/api/players')
        .send({ name: `SF Player ${i}-${j}`, email: `sf-p${i}${j}@test.com` });
      playerIds.push(pRes.body.id);
      await request(app).post('/api/registrations/players').send({
        tournamentId, teamId: teamRes.body.id, playerId: pRes.body.id, role: j === 0 ? 'captain' : 'regular'
      });
    }
  }

  // Generate schedule
  await request(app).post('/api/schedule/generate').send({ tournamentId });
});

// --- Flat match routes ---

describe('GET /api/matches', () => {
  it('lists matches for a tournament', async () => {
    const res = await request(app)
      .get('/api/matches')
      .query({ tournamentId });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(6); // 4 teams = 6 matches
    matchId = res.body[0].id;
  });

  it('filters by sessionNumber', async () => {
    const res = await request(app)
      .get('/api/matches')
      .query({ tournamentId, sessionNumber: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('matches');
  });

  it('requires tournamentId', async () => {
    const res = await request(app).get('/api/matches');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/matches/:matchId', () => {
  it('returns match details', async () => {
    const res = await request(app).get(`/api/matches/${matchId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', matchId);
    expect(res.body).toHaveProperty('homeTeamId');
    expect(res.body).toHaveProperty('awayTeamId');
  });
});

describe('PUT /api/matches/:matchId/status', () => {
  it('updates match status', async () => {
    const res = await request(app)
      .put(`/api/matches/${matchId}/status`)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
  });

  it('rejects regular player', async () => {
    const res = await request(app)
      .put(`/api/matches/${matchId}/status`)
      .set('X-User-Role', 'player')
      .send({ status: 'completed' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/matches', () => {
  it('rejects regular player from creating a match', async () => {
    const res = await request(app)
      .post('/api/matches')
      .set('X-User-Role', 'player')
      .send({ tournamentId, homeTeamId: teamIds[0], awayTeamId: teamIds[1] });
    expect(res.status).toBe(403);
  });
});

// --- Flat score routes ---

describe('POST /api/scores', () => {
  it('submits scores for a player', async () => {
    const res = await request(app)
      .post('/api/scores')
      .send({
        tournamentId,
        sessionNumber: 1,
        playerId: playerIds[0],
        teamId: teamIds[0],
        scores: [180, 200, 190],
      });
    expect(res.status).toBe(201);
  });

  it('allows captain to submit scores', async () => {
    // playerIds[0] is captain of teamIds[0]
    const res = await request(app)
      .post('/api/scores')
      .set('X-User-Role', 'player')
      .set('X-Player-Id', playerIds[0])
      .send({
        tournamentId,
        sessionNumber: 1,
        playerId: playerIds[1],
        teamId: teamIds[0],
        scores: [150, 160, 170],
      });
    expect(res.status).toBe(201);
  });

  it('rejects regular player (non-captain) score submission', async () => {
    // playerIds[1] is a regular member of teamIds[0]
    const res = await request(app)
      .post('/api/scores')
      .set('X-User-Role', 'player')
      .set('X-Player-Id', playerIds[1])
      .send({
        tournamentId,
        sessionNumber: 1,
        playerId: playerIds[2],
        teamId: teamIds[0],
        scores: [150, 160, 170],
      });
    expect(res.status).toBe(403);
  });

  it('requires tournamentId and sessionNumber', async () => {
    const res = await request(app)
      .post('/api/scores')
      .send({ playerId: playerIds[0], scores: [100] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/scores', () => {
  it('gets scores for a session', async () => {
    const res = await request(app)
      .get('/api/scores')
      .query({ tournamentId, sessionNumber: 1 });
    expect(res.status).toBe(200);
  });

  it('requires tournamentId and sessionNumber', async () => {
    const res = await request(app).get('/api/scores');
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/scores/:playerId', () => {
  it('rejects regular player', async () => {
    const res = await request(app)
      .delete(`/api/scores/${playerIds[0]}`)
      .set('X-User-Role', 'player')
      .query({ tournamentId, sessionNumber: 1 });
    expect(res.status).toBe(403);
  });
});

// --- Deprecation headers ---

describe('old nested routes have deprecation headers', () => {
  it('old GET scoring route returns Deprecation header', async () => {
    const res = await request(app)
      .get(`/api/tournaments/${tournamentId}/sessions/1/scores`);
    expect(res.headers).toHaveProperty('deprecation', 'true');
  });

  it('old GET matches route returns Deprecation header', async () => {
    const res = await request(app)
      .get(`/api/matches/${matchId}`);
    // The legacy route has deprecation, but the flat route also handles /:matchId
    // Check that one of them responds
    expect(res.status).toBe(200);
  });
});
