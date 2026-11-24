// tests/standings-statistics.test.js
// TDD tests for Phase 5: flat /api/standings and /api/statistics routes
const request = require('supertest');
const app = require('../server');

let leagueId, tournamentId;

beforeAll(async () => {
  const leaguesRes = await request(app).get('/api/leagues');
  leagueId = leaguesRes.body[0].id;

  // Create tournament
  const tRes = await request(app)
    .post('/api/tournaments')
    .send({
      name: 'Stats Test Tournament',
      startDate: '2027-03-01',
      endDate: '2027-06-01',
      maxTeams: 4,
      totalSessions: 3,
      sessionType: 'weekly',
      leagueId,
    });
  tournamentId = tRes.body.id;
});

// --- Flat standings ---

describe('GET /api/standings', () => {
  it('returns standings for a tournament (public, no auth)', async () => {
    const res = await request(app)
      .get('/api/standings')
      .query({ tournamentId });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('requires tournamentId', async () => {
    const res = await request(app).get('/api/standings');
    expect(res.status).toBe(400);
  });
});

// --- Flat statistics ---

describe('GET /api/statistics', () => {
  it('returns aggregate stats for a tournament (public)', async () => {
    const res = await request(app)
      .get('/api/statistics')
      .query({ tournamentId });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalTeams');
    expect(res.body).toHaveProperty('totalPlayers');
  });

  it('requires tournamentId', async () => {
    const res = await request(app).get('/api/statistics');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/statistics/players', () => {
  it('returns all player stats for a tournament', async () => {
    const res = await request(app)
      .get('/api/statistics/players')
      .query({ tournamentId });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/statistics/teams', () => {
  it('returns all team stats for a tournament', async () => {
    const res = await request(app)
      .get('/api/statistics/teams')
      .query({ tournamentId });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('PUT /api/statistics/players/:playerId', () => {
  it('rejects regular player from updating stats', async () => {
    const players = await request(app).get('/api/players');
    const playerId = players.body[0]?.id;
    if (!playerId) return; // skip if no players

    const res = await request(app)
      .put(`/api/statistics/players/${playerId}`)
      .set('X-User-Role', 'player')
      .send({ tournamentId, gamesPlayed: 10, totalPins: 1800 });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/statistics/teams/:teamId', () => {
  it('rejects regular player from updating stats', async () => {
    const teams = await request(app).get('/api/teams');
    const teamId = teams.body[0]?.id;
    if (!teamId) return;

    const res = await request(app)
      .put(`/api/statistics/teams/${teamId}`)
      .set('X-User-Role', 'player')
      .send({ tournamentId, totalMatchesPlayed: 5 });
    expect(res.status).toBe(403);
  });
});

// --- Deprecation headers ---

describe('old nested routes have deprecation headers', () => {
  it('old standings route returns Deprecation header', async () => {
    const res = await request(app)
      .get(`/api/tournaments/${tournamentId}/standings`);
    expect(res.headers).toHaveProperty('deprecation', 'true');
  });

  it('old statistics route returns Deprecation header', async () => {
    const res = await request(app)
      .get(`/api/tournaments/${tournamentId}/statistics`);
    expect(res.headers).toHaveProperty('deprecation', 'true');
  });
});
