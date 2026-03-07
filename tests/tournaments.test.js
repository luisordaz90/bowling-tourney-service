// tests/tournaments.test.js
// Integration tests for the tournament domain.
// Exercises: create tournament, register team, get roster, 404 handling, camelCase output.
const request = require('supertest');
const app = require('../server');

// Shared state populated by setup
let teamId;
let tournamentId;

beforeAll(async () => {
  // Create a team to use across tournament tests
  const teamRes = await request(app)
    .post('/api/teams')
    .send({
      name: 'Tourney Test Strikers',
      captainName: 'Alice',
      captainEmail: 'alice.tourney@test.com',
    });
  teamId = teamRes.body.id;
});

describe('Tournament creation', () => {
  it('creates a new tournament and returns 201 with an id', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .send({
        name: 'Spring Bowl 2026',
        startDate: '2026-04-01',
        endDate: '2026-06-30',
        maxTeams: 8,
        totalSessions: 7,
        sessionType: 'weekly',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    tournamentId = res.body.id;
  });

  it('returns camelCase keys for tournament GET', async () => {
    const res = await request(app).get(`/api/tournaments/${tournamentId}`);

    expect(res.status).toBe(200);
    // outputFormatter converts snake_case → camelCase
    expect(res.body).toHaveProperty('startDate');
    expect(res.body).toHaveProperty('maxTeams');
    expect(res.body).not.toHaveProperty('start_date');
  });

  it('returns 404 for a non-existent tournament', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app).get(`/api/tournaments/${fakeId}`);

    expect(res.status).toBe(404);
  });
});

describe('Team registration in tournament', () => {
  it('registers a team to a tournament and returns 201', async () => {
    const res = await request(app)
      .post(`/api/tournaments/${tournamentId}/teams`)
      .send({ teamId });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('teamId', teamId);
  });

  it('rejects duplicate team registration with 400', async () => {
    const res = await request(app)
      .post(`/api/tournaments/${tournamentId}/teams`)
      .send({ teamId });

    expect(res.status).toBe(400);
  });

  it('lists the registered teams for a tournament', async () => {
    const res = await request(app).get(`/api/tournaments/${tournamentId}/teams`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const ids = res.body.map(t => t.teamId || t.id);
    expect(ids).toContain(teamId);
  });
});
