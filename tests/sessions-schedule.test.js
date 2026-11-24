// tests/sessions-schedule.test.js
// TDD tests for Phase 3: flat /api/sessions and /api/schedule routes
const request = require('supertest');
const app = require('../server');

let leagueId, tournamentId, teamIds = [];

beforeAll(async () => {
  // Fetch a league
  const leaguesRes = await request(app).get('/api/leagues');
  leagueId = leaguesRes.body[0].id;

  // Create tournament
  const tRes = await request(app)
    .post('/api/tournaments')
    .send({
      name: 'Session Schedule Test Tournament',
      startDate: '2026-11-01',
      endDate: '2027-02-01',
      maxTeams: 8,
      totalSessions: 7,
      sessionType: 'weekly',
      leagueId,
    });
  tournamentId = tRes.body.id;

  // Create and register 4 teams
  for (let i = 0; i < 4; i++) {
    const teamRes = await request(app)
      .post('/api/teams')
      .send({ name: `SS Team ${i + 1}`, captainName: `Cap ${i}`, captainEmail: `ss-cap${i}@test.com` });
    teamIds.push(teamRes.body.id);
    await request(app)
      .post('/api/registrations/teams')
      .send({ tournamentId, teamId: teamRes.body.id });
  }
});

// --- Flat session routes ---

describe('POST /api/sessions', () => {
  it('creates a session with tournamentId in body', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .send({ tournamentId, sessionNumber: 1, sessionDate: '2026-11-08', sessionName: 'Week 1' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('sessionNumber', 1);
    expect(res.body).toHaveProperty('sessionName', 'Week 1');
  });

  it('rejects duplicate session number', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .send({ tournamentId, sessionNumber: 1, sessionDate: '2026-11-08' });
    expect(res.status).toBe(400);
  });

  it('rejects regular player from creating a session', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('X-User-Role', 'player')
      .send({ tournamentId, sessionNumber: 99, sessionDate: '2026-12-01' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/sessions', () => {
  it('lists sessions for a tournament', async () => {
    const res = await request(app)
      .get('/api/sessions')
      .query({ tournamentId });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('requires tournamentId query param', async () => {
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/sessions/:id/status', () => {
  it('updates session status', async () => {
    // Get the session we created
    const sessions = await request(app).get('/api/sessions').query({ tournamentId });
    const sessionId = sessions.body[0].id;

    const res = await request(app)
      .put(`/api/sessions/${sessionId}/status`)
      .send({ status: 'active' });
    expect(res.status).toBe(200);
  });

  it('rejects invalid status', async () => {
    const sessions = await request(app).get('/api/sessions').query({ tournamentId });
    const sessionId = sessions.body[0].id;

    const res = await request(app)
      .put(`/api/sessions/${sessionId}/status`)
      .send({ status: 'invalid' });
    expect(res.status).toBe(400);
  });
});

// --- Flat schedule routes ---

describe('GET /api/schedule/preview', () => {
  it('previews round-robin schedule', async () => {
    const res = await request(app)
      .get('/api/schedule/preview')
      .query({ tournamentId });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalTeams', 4);
    expect(res.body).toHaveProperty('schedule');
    expect(res.body).toHaveProperty('isValidSchedule');
  });

  it('requires tournamentId', async () => {
    const res = await request(app).get('/api/schedule/preview');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/schedule/generate', () => {
  it('rejects regular player', async () => {
    const res = await request(app)
      .post('/api/schedule/generate')
      .set('X-User-Role', 'player')
      .send({ tournamentId });
    expect(res.status).toBe(403);
  });

  it('generates round-robin schedule', async () => {
    const res = await request(app)
      .post('/api/schedule/generate')
      .send({ tournamentId });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('totalMatchesCreated');
    expect(res.body.totalMatchesCreated).toBe(6); // 4 teams = 6 matches
  });
});

describe('GET /api/schedule/summary', () => {
  it('returns schedule summary', async () => {
    const res = await request(app)
      .get('/api/schedule/summary')
      .query({ tournamentId });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('matchStats');
    expect(res.body.matchStats.total).toBe(6);
  });
});

describe('GET /api/schedule/validate', () => {
  it('validates the schedule', async () => {
    const res = await request(app)
      .get('/api/schedule/validate')
      .query({ tournamentId });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('isValid');
  });
});

describe('DELETE /api/schedule', () => {
  it('rejects regular player', async () => {
    const res = await request(app)
      .delete('/api/schedule')
      .set('X-User-Role', 'player')
      .query({ tournamentId });
    expect(res.status).toBe(403);
  });

  it('deletes the schedule', async () => {
    const res = await request(app)
      .delete('/api/schedule')
      .query({ tournamentId });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('removedMatches');
  });
});

// --- Deprecation headers on old routes ---

describe('old nested routes have deprecation headers', () => {
  it('old GET /api/tournaments/:id/sessions returns Deprecation header', async () => {
    const res = await request(app)
      .get(`/api/tournaments/${tournamentId}/sessions`);
    expect(res.headers).toHaveProperty('deprecation', 'true');
  });

  it('old GET /api/tournaments/:id/schedule/summary returns Deprecation header', async () => {
    const res = await request(app)
      .get(`/api/tournaments/${tournamentId}/schedule/summary`);
    expect(res.headers).toHaveProperty('deprecation', 'true');
  });
});
