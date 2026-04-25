// tests/matches.test.js
// Integration tests for the match/scoring domain.
// Flow: create tournament → register 2 teams + players → generate round-robin → score via session endpoint.
const request = require('supertest');
const app = require('../server');

let tournamentId;
let homeTeamId;
let awayTeamId;
let homePlayerId;
let awayPlayerId;
let matchId;
let sessionNumber;

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

  // Generate round-robin schedule (creates sessions + matches)
  await request(app)
    .post(`/api/tournaments/${tournamentId}/schedule/round-robin`)
    .send({});

  // Fetch the first generated match and its session number
  const matchesRes = await request(app).get(`/api/tournaments/${tournamentId}/matches`);
  const firstMatch = matchesRes.body[0];
  matchId = firstMatch?.id || firstMatch?.matchId;
  sessionNumber = firstMatch?.sessionNumber;
});

describe('Match score recording', () => {
  it('records a player score and returns 201', async () => {
    const res = await request(app)
      .post(`/api/tournaments/${tournamentId}/sessions/${sessionNumber}/scores`)
      .send({
        teamId: homeTeamId,
        playerId: homePlayerId,
        scores: [180, 200, 190],
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('matchId');
    expect(res.body.matchId).not.toBeNull();
  });

  it('rejects a duplicate player score entry with 400', async () => {
    const res = await request(app)
      .post(`/api/tournaments/${tournamentId}/sessions/${sessionNumber}/scores`)
      .send({
        teamId: homeTeamId,
        playerId: homePlayerId,
        scores: [150, 160, 170],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already recorded/i);
  });

  it('rejects a score above 300 with 400', async () => {
    const res = await request(app)
      .post(`/api/tournaments/${tournamentId}/sessions/${sessionNumber}/scores`)
      .send({
        teamId: awayTeamId,
        playerId: awayPlayerId,
        scores: [301, 200, 190],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 0 and 300/i);
  });

  it('calculates team score from player scores and returns 201', async () => {
    // First record the away player score with valid values
    await request(app)
      .post(`/api/tournaments/${tournamentId}/sessions/${sessionNumber}/scores`)
      .send({
        teamId: awayTeamId,
        playerId: awayPlayerId,
        scores: [160, 170, 175],
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

describe('Match score update (PUT)', () => {
  it('updates player scores and returns 200', async () => {
    const res = await request(app)
      .put(`/api/tournaments/${tournamentId}/sessions/${sessionNumber}/scores/${homePlayerId}`)
      .send({ teamId: homeTeamId, scores: [210, 220, 230] });

    expect(res.status).toBe(200);
    expect(res.body.scores).toEqual([210, 220, 230]);
  });

  it('recomputes match points after update on a completed match', async () => {
    // Scores updated — one team should dominate. Check that points were recomputed.
    const res = await request(app).get(`/api/matches/${matchId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    const maxPts = Math.max(
      res.body.pointsBreakdown.homeTeam.totalPoints,
      res.body.pointsBreakdown.awayTeam.totalPoints
    );
    expect(maxPts).toBeGreaterThanOrEqual(3);
  });

  it('rejects invalid scores with 400', async () => {
    const res = await request(app)
      .put(`/api/tournaments/${tournamentId}/sessions/${sessionNumber}/scores/${homePlayerId}`)
      .send({ teamId: homeTeamId, scores: [301, 220, 230] });

    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent player', async () => {
    const res = await request(app)
      .put(`/api/tournaments/${tournamentId}/sessions/${sessionNumber}/scores/00000000-0000-0000-0000-000000000000`)
      .send({ teamId: homeTeamId, scores: [200, 200, 200] });

    expect(res.status).toBe(404);
  });
});

describe('Match score delete (DELETE)', () => {
  it('deletes player scores and reverts match status', async () => {
    const res = await request(app)
      .delete(`/api/tournaments/${tournamentId}/sessions/${sessionNumber}/scores/${homePlayerId}`)
      .send({ teamId: homeTeamId });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);

    // Match should no longer be completed
    const matchRes = await request(app).get(`/api/matches/${matchId}`);
    expect(matchRes.body.status).toBe('in_progress');
    expect(matchRes.body.winnerTeamName).toBeNull();
  });

  it('returns 404 when deleting already-deleted scores', async () => {
    const res = await request(app)
      .delete(`/api/tournaments/${tournamentId}/sessions/${sessionNumber}/scores/${homePlayerId}`)
      .send({ teamId: homeTeamId });

    expect(res.status).toBe(404);
  });
});
