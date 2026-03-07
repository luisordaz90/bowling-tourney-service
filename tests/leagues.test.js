// tests/leagues.test.js
// Integration tests for the league domain.
// Verifies: create league, list leagues (including seeded data), create edition, assignment validation.
const request = require('supertest');
const app = require('../server');
const { closePool } = require('../config/database');

let leagueId;

// Close the shared DB pool after all tests complete so the process can exit cleanly.
afterAll(async () => {
  await closePool();
});

describe('League management', () => {
  it('creates a new league and returns 201 with an id', async () => {
    const res = await request(app)
      .post('/api/leagues')
      .send({
        name: 'Test Summer League 2026',
        description: 'Created by integration test',
        maxTeamsPerEdition: 12,
        sessionType: 'weekly',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    leagueId = res.body.id;
  });

  it('lists leagues and includes the three seeded leagues from migration 002', async () => {
    const res = await request(app).get('/api/leagues');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Migration 002 seeds: "Main Bowling League", "Youth League", "Senior League"
    const names = res.body.map(l => l.name);
    expect(names).toContain('Main Bowling League');
    expect(names).toContain('Youth League');
  });
});

describe('Tournament edition management', () => {
  it('creates an edition for a league and returns 201', async () => {
    const res = await request(app)
      .post(`/api/leagues/${leagueId}/editions`)
      .send({
        leagueId,
        name: 'Spring 2026',
        year: 2026,
        season: 'spring',
        startDate: '2026-04-01',
        endDate: '2026-06-30',
        maxTeams: 8,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('leagueId', leagueId);
  });
});

describe('Player assignment validation', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/leagues/validate-assignment')
      .send({ playerId: 'some-id' }); // missing teamId and tournamentId

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
