// tests/team-detail.test.js
// TDD test for enriched GET /api/teams/:teamId
const request = require('supertest');
const app = require('../server');

let teamId, playerId, leagueId, tournamentId;

beforeAll(async () => {
  const teamRes = await request(app)
    .post('/api/teams')
    .send({ name: 'Detail Test Team', captainName: 'Cap', captainEmail: 'detail@test.com' });
  teamId = teamRes.body.id;

  const playerRes = await request(app)
    .post('/api/players')
    .send({ name: 'Detail Player', email: 'detail-player@test.com' });
  playerId = playerRes.body.id;

  const leaguesRes = await request(app).get('/api/leagues');
  leagueId = leaguesRes.body[0].id;

  const tournamentRes = await request(app)
    .post('/api/tournaments')
    .send({
      name: 'Detail Tournament',
      startDate: '2026-10-01',
      endDate: '2026-12-01',
      maxTeams: 8,
      totalSessions: 7,
      sessionType: 'weekly',
      leagueId,
    });
  tournamentId = tournamentRes.body.id;

  // Register team + player
  await request(app)
    .post('/api/registrations/teams')
    .send({ tournamentId, teamId });
  await request(app)
    .post('/api/registrations/players')
    .send({ tournamentId, teamId, playerId, role: 'captain' });
});

describe('GET /api/teams/:teamId (enriched)', () => {
  it('returns team with roster and tournament enrollments', async () => {
    const res = await request(app).get(`/api/teams/${teamId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'Detail Test Team');
    expect(res.body).toHaveProperty('roster');
    expect(Array.isArray(res.body.roster)).toBe(true);
    expect(res.body.roster.length).toBe(1);
    expect(res.body.roster[0]).toHaveProperty('name', 'Detail Player');
    expect(res.body.roster[0]).toHaveProperty('role', 'captain');

    expect(res.body).toHaveProperty('tournaments');
    expect(Array.isArray(res.body.tournaments)).toBe(true);
    expect(res.body.tournaments.length).toBe(1);
    expect(res.body.tournaments[0]).toHaveProperty('tournamentName', 'Detail Tournament');
    expect(res.body.tournaments[0]).toHaveProperty('leagueName');
  });

  it('returns 404 for non-existent team', async () => {
    const res = await request(app).get('/api/teams/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});
