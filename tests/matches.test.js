// tests/matches.test.js
// Integration tests for the match/scoring domain.
// Flow: create tournament → register 2 teams + players → generate round-robin → score a match.
const request = require('supertest');
const app = require('../server');

let tournamentId;
let homeTeamId;
let awayTeamId;
let homePlayerId;
let awayPlayerId;
let matchId;

beforeAll(async () => {
  // Create two teams
  const homeTeamRes = await request(app)
    .post('/api/teams')
    .send({ name: 'Match Test Home Pins', captainName: 'Bob', captainEmail: 'bob.match@test.com' });
  homeTeamId = homeTeamRes.body.id;

  const awayTeamRes = await request(app)
    .post('/api/teams')
    .send({ name: 'Match Test Away Pins', captainName: 'Carol', captainEmail: 'carol.match@test.com' });
  awayTeamId = awayTeamRes.body.id;

  // Create two players
  const homePlayerRes = await request(app)
    .post('/api/players')
    .send({ name: 'Match Player Bob', email: 'match.bob@test.com' });
  homePlayerId = homePlayerRes.body.id;

  const awayPlayerRes = await request(app)
    .post('/api/players')
    .send({ name: 'Match Player Carol', email: 'match.carol@test.com' });
  awayPlayerId = awayPlayerRes.body.id;

  // Create tournament
  const tourneyRes = await request(app)
    .post('/api/tournaments')
    .send({
      name: 'Match Test Bowl 2026',
      startDate: '2026-04-01',
      endDate: '2026-06-30',
      maxTeams: 4,
      totalSessions: 2,
      sessionType: 'weekly',
    });
  tournamentId = tourneyRes.body.id;

  // Register teams
  await request(app)
    .post(`/api/tournaments/${tournamentId}/teams`)
    .send({ teamId: homeTeamId });
  await request(app)
    .post(`/api/tournaments/${tournamentId}/teams`)
    .send({ teamId: awayTeamId });

  // Register players to their teams in the tournament
  await request(app)
    .post(`/api/tournaments/${tournamentId}/teams/${homeTeamId}/players`)
    .send({ playerId: homePlayerId });
  await request(app)
    .post(`/api/tournaments/${tournamentId}/teams/${awayTeamId}/players`)
    .send({ playerId: awayPlayerId });

  // Generate round-robin schedule (creates matches)
  await request(app)
    .post(`/api/tournaments/${tournamentId}/schedule/round-robin`)
    .send({});

  // Fetch the first generated match
  const matchesRes = await request(app).get(`/api/tournaments/${tournamentId}/matches`);
  matchId = matchesRes.body[0]?.id || matchesRes.body[0]?.matchId;
});

describe('Match score recording', () => {
  it('records a player score and returns 201', async () => {
    const res = await request(app)
      .post(`/api/matches/${matchId}/player-scores`)
      .send({
        teamId: homeTeamId,
        playerId: homePlayerId,
        game1Score: 180,
        game2Score: 200,
        game3Score: 190,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('matchId', matchId);
  });

  it('rejects a duplicate player score entry with 400', async () => {
    const res = await request(app)
      .post(`/api/matches/${matchId}/player-scores`)
      .send({
        teamId: homeTeamId,
        playerId: homePlayerId,
        game1Score: 150,
        game2Score: 160,
        game3Score: 170,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already recorded/i);
  });

  it('rejects a score above 300 with 400', async () => {
    const res = await request(app)
      .post(`/api/matches/${matchId}/player-scores`)
      .send({
        teamId: awayTeamId,
        playerId: awayPlayerId,
        game1Score: 301,
        game2Score: 200,
        game3Score: 190,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 0 and 300/i);
  });

  it('calculates team score from player scores and returns 201', async () => {
    // First record the away player score with valid values
    await request(app)
      .post(`/api/matches/${matchId}/player-scores`)
      .send({
        teamId: awayTeamId,
        playerId: awayPlayerId,
        game1Score: 160,
        game2Score: 170,
        game3Score: 175,
      });

    const res = await request(app)
      .post(`/api/matches/${matchId}/team-scores/calculate`)
      .send({ teamId: homeTeamId });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('totalTeamScore');
  });

  it('completes the match and creates match_points when both teams submit scores', async () => {
    // Calculate away team score — this triggers match completion
    const res = await request(app)
      .post(`/api/matches/${matchId}/team-scores/calculate`)
      .send({ teamId: awayTeamId });

    expect(res.status).toBe(201);
    expect(res.body.matchCompleted).toBe(true);
  });

  it('GET /api/matches/:matchId reflects completed status after scoring', async () => {
    const res = await request(app).get(`/api/matches/${matchId}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });
});
