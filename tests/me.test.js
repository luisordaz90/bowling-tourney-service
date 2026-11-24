// tests/me.test.js
// Tests for Phase 1: requireTeamContext fix + /api/me/* endpoints
const request = require('supertest');
const app = require('../server');
const { query } = require('../config/database');

let playerId;
let teamId;
let leagueId;
let tournamentId;

beforeAll(async () => {
  // Create a player
  const playerRes = await request(app)
    .post('/api/players')
    .send({ name: 'Me Test Player', email: 'me-test@example.com' });
  playerId = playerRes.body.id;

  // Fetch a seeded league
  const leaguesRes = await request(app).get('/api/leagues');
  leagueId = leaguesRes.body[0].id;

  // Create a team
  const teamRes = await request(app)
    .post('/api/teams')
    .send({ name: 'Me Test Team', captainName: 'Captain', captainEmail: 'captain@test.com' });
  teamId = teamRes.body.id;

  // Create a tournament
  const tournamentRes = await request(app)
    .post('/api/tournaments')
    .send({
      name: 'Me Test Tournament',
      startDate: '2026-04-01',
      endDate: '2026-06-30',
      maxTeams: 8,
      totalSessions: 7,
      sessionType: 'weekly',
      leagueId,
    });
  tournamentId = tournamentRes.body.id;

  // Register team to tournament
  await request(app)
    .post(`/api/tournaments/${tournamentId}/teams`)
    .send({ teamId });

  // Add player to team roster
  await request(app)
    .post(`/api/tournaments/${tournamentId}/teams/${teamId}/players`)
    .send({ playerId, role: 'captain' });
});

describe('requireTeamContext does not intercept non-team :id params', () => {
  it('GET /api/players/:id does not treat player ID as team ID', async () => {
    const res = await request(app).get(`/api/players/${playerId}`);
    // Should return the player, not a 403 "Not a member of this team"
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Me Test Player');
  });
});

describe('/api/me endpoints', () => {
  // Simulate authenticated user by setting req.player in tests
  // In test env, JWT is skipped -- we need to set up a way to identify "me"
  // For now, we test the endpoints exist and respond

  it('GET /api/me/teams returns the authenticated player teams', async () => {
    const res = await request(app)
      .get('/api/me/teams')
      .set('X-Player-Id', playerId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('name', 'Me Test Team');
    expect(res.body[0]).toHaveProperty('leagueName');
    expect(res.body[0]).toHaveProperty('tournamentName');
  });

  it('GET /api/me/leagues returns leagues the player is in', async () => {
    const res = await request(app)
      .get('/api/me/leagues')
      .set('X-Player-Id', playerId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body[0]).toHaveProperty('leagueType');
  });

  it('GET /api/me/dashboard returns the player dashboard', async () => {
    const res = await request(app)
      .get('/api/me/dashboard')
      .set('X-Player-Id', playerId);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('player');
    expect(res.body).toHaveProperty('currentTeams');
    expect(res.body).toHaveProperty('overallStatistics');
    expect(res.body).toHaveProperty('recentScores');
    expect(res.body.player.name).toBe('Me Test Player');
  });

  it('GET /api/me/statistics returns the player statistics', async () => {
    const res = await request(app)
      .get('/api/me/statistics')
      .set('X-Player-Id', playerId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/me/league-history returns league history', async () => {
    const res = await request(app)
      .get('/api/me/league-history')
      .set('X-Player-Id', playerId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('leagueName');
    expect(res.body[0]).toHaveProperty('teamName');
  });
});

describe('Deprecated player routes return Deprecation header', () => {
  it('GET /api/players/:playerId/teams returns Deprecation header', async () => {
    const res = await request(app).get(`/api/players/${playerId}/teams`);
    expect(res.status).toBe(200);
    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.link).toContain('/api/me/teams');
  });

  it('GET /api/players/:playerId/statistics returns Deprecation header', async () => {
    const res = await request(app).get(`/api/players/${playerId}/statistics`);
    expect(res.status).toBe(200);
    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.link).toContain('/api/me/statistics');
  });
});
