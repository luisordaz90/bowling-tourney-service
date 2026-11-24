// tests/registrations.test.js
// TDD tests for flat /api/registrations/* routes
const request = require('supertest');
const app = require('../server');

let leagueId, tournamentId, teamId, playerId;

beforeAll(async () => {
  const leaguesRes = await request(app).get('/api/leagues');
  leagueId = leaguesRes.body[0].id;

  const teamRes = await request(app)
    .post('/api/teams')
    .send({ name: 'Reg Flat Team', captainName: 'Cap', captainEmail: 'reg-flat@test.com' });
  teamId = teamRes.body.id;

  const tournamentRes = await request(app)
    .post('/api/tournaments')
    .send({
      name: 'Reg Flat Tournament',
      startDate: '2026-10-01',
      endDate: '2026-12-01',
      maxTeams: 8,
      totalSessions: 7,
      sessionType: 'weekly',
      leagueId,
    });
  tournamentId = tournamentRes.body.id;

  const playerRes = await request(app)
    .post('/api/players')
    .send({ name: 'Reg Flat Player', email: 'reg-flat-player@test.com' });
  playerId = playerRes.body.id;
});

describe('POST /api/registrations/teams', () => {
  it('registers a team to a tournament', async () => {
    const res = await request(app)
      .post('/api/registrations/teams')
      .send({ tournamentId, teamId });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('teamId');
    expect(res.body).toHaveProperty('tournamentId');
  });

  it('rejects duplicate registration', async () => {
    const res = await request(app)
      .post('/api/registrations/teams')
      .send({ tournamentId, teamId });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/registrations/teams', () => {
  it('lists registered teams for a tournament', async () => {
    const res = await request(app)
      .get('/api/registrations/teams')
      .query({ tournamentId });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('POST /api/registrations/players', () => {
  it('registers a player to a team in a tournament', async () => {
    const res = await request(app)
      .post('/api/registrations/players')
      .send({ tournamentId, teamId, playerId, role: 'regular' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('playerId');
  });

  it('rejects duplicate player assignment', async () => {
    const res = await request(app)
      .post('/api/registrations/players')
      .send({ tournamentId, teamId, playerId, role: 'regular' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/registrations/players', () => {
  it('lists roster for a team in a tournament', async () => {
    const res = await request(app)
      .get('/api/registrations/players')
      .query({ tournamentId, teamId });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('DELETE /api/registrations/players/:playerId', () => {
  it('removes a player from the roster', async () => {
    const res = await request(app)
      .delete(`/api/registrations/players/${playerId}`)
      .query({ tournamentId, teamId });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/registrations/teams/:teamId', () => {
  it('unregisters a team from a tournament', async () => {
    const res = await request(app)
      .delete(`/api/registrations/teams/${teamId}`)
      .query({ tournamentId });
    expect(res.status).toBe(204);
  });
});

describe('old registration routes have deprecation headers', () => {
  it('old team registration route returns Deprecation header', async () => {
    // Re-register for this test
    await request(app)
      .post('/api/registrations/teams')
      .send({ tournamentId, teamId });

    const res = await request(app)
      .get(`/api/tournaments/${tournamentId}/teams`);
    expect(res.headers).toHaveProperty('deprecation', 'true');
    expect(res.headers).toHaveProperty('link');
  });
});
