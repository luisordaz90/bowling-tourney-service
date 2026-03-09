// tests/sessionEntries.test.js
// Integration tests for the unified score submission endpoint.
// Covers: open format (session_entries) and paired format (player_match_scores),
// standings by pins, and handicap recalculation trigger.
const request = require('supertest');
const app = require('../server');

let tournamentId;
let matchplayTournamentId;
let playerOneId;
let playerTwoId;
let soloTeamOneId;
let soloTeamTwoId;

// Player 1: 180/180/180 → raw avg 180 → hdcp = FLOOR((220-180)*0.90) = 36
const P1_GAMES = { game1Score: 180, game2Score: 180, game3Score: 180 };
const P1_RAW   = 540;
const P1_HDCP  = 36;
const P1_TOTAL = P1_RAW + P1_HDCP * 3; // 648

// Player 2: 210/210/210 → raw avg 210 → hdcp = FLOOR((220-210)*0.90) = 9
const P2_GAMES = { game1Score: 210, game2Score: 210, game3Score: 210 };
const P2_RAW   = 630;

beforeAll(async () => {
  // Players
  const p1Res = await request(app).post('/api/players')
    .send({ name: 'Solo Player One', email: 'solo.one@test.com' });
  playerOneId = p1Res.body.id;

  const p2Res = await request(app).post('/api/players')
    .send({ name: 'Solo Player Two', email: 'solo.two@test.com' });
  playerTwoId = p2Res.body.id;

  // Solo teams (one player each)
  const t1Res = await request(app).post('/api/teams')
    .send({ name: 'Solo Team One', captainName: 'Solo Player One', captainEmail: 'solo.one@test.com', teamType: 'solo' });
  soloTeamOneId = t1Res.body.id;

  const t2Res = await request(app).post('/api/teams')
    .send({ name: 'Solo Team Two', captainName: 'Solo Player Two', captainEmail: 'solo.two@test.com', teamType: 'solo' });
  soloTeamTwoId = t2Res.body.id;

  // Open/pins tournament
  const tRes = await request(app).post('/api/tournaments')
    .send({
      name: 'Open Solo Bowl 2026',
      startDate: '2026-04-01', endDate: '2026-06-30',
      maxTeams: 8, totalSessions: 4, sessionType: 'weekly',
      scheduleType: 'open', rankingMethod: 'pins',
      hdcpBase: 220, hdcpPercentage: 0.90,
    });
  tournamentId = tRes.body.id;

  // Standard paired/points tournament
  const mpRes = await request(app).post('/api/tournaments')
    .send({
      name: 'Matchplay Bowl 2026',
      startDate: '2026-04-01', endDate: '2026-06-30',
      maxTeams: 8, totalSessions: 4, sessionType: 'weekly',
    });
  matchplayTournamentId = mpRes.body.id;

  // Register teams to open tournament
  await request(app).post(`/api/tournaments/${tournamentId}/teams`).send({ teamId: soloTeamOneId });
  await request(app).post(`/api/tournaments/${tournamentId}/teams`).send({ teamId: soloTeamTwoId });

  // Create session 1 for open tournament
  await request(app).post(`/api/tournaments/${tournamentId}/sessions`)
    .send({ sessionNumber: 1, sessionName: 'Week 1', sessionDate: '2026-04-07' });
});

describe('Score submission — open format', () => {
  it('records a score and returns 201 with correct computed fields', async () => {
    const res = await request(app)
      .post(`/api/tournaments/${tournamentId}/scores`)
      .send({ sessionNumber: 1, playerId: playerOneId, teamId: soloTeamOneId, ...P1_GAMES });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.playerId).toBe(playerOneId);
    expect(res.body.sessionNumber).toBe(1);
    // First session — no prior hdcp, so handicapApplied = 0
    expect(res.body.handicapApplied).toBe(0);
    expect(res.body.totalPins).toBe(P1_RAW);
    expect(res.body.sessionAverage).toBeCloseTo(180, 1);
  });

  it('rejects a duplicate score for the same player in the same session with 400', async () => {
    const res = await request(app)
      .post(`/api/tournaments/${tournamentId}/scores`)
      .send({ sessionNumber: 1, playerId: playerOneId, teamId: soloTeamOneId, ...P1_GAMES });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already recorded/i);
  });

  it('rejects a score above 300 with 400', async () => {
    const res = await request(app)
      .post(`/api/tournaments/${tournamentId}/scores`)
      .send({ sessionNumber: 1, playerId: playerTwoId, teamId: soloTeamTwoId, game1Score: 301, game2Score: 200, game3Score: 200 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 0 and 300/i);
  });

  it('records a second player score in the same session', async () => {
    const res = await request(app)
      .post(`/api/tournaments/${tournamentId}/scores`)
      .send({ sessionNumber: 1, playerId: playerTwoId, teamId: soloTeamTwoId, ...P2_GAMES });

    expect(res.status).toBe(201);
    expect(res.body.handicapApplied).toBe(0);
    expect(res.body.totalPins).toBe(P2_RAW);
    expect(res.body.sessionAverage).toBeCloseTo(210, 1);
  });
});

describe('Score submission — paired format', () => {
  it('returns 404 when no session exists for the given sessionNumber', async () => {
    const res = await request(app)
      .post(`/api/tournaments/${matchplayTournamentId}/scores`)
      .send({ sessionNumber: 99, playerId: playerOneId, teamId: soloTeamOneId, ...P1_GAMES });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/session not found/i);
  });
});

describe('Score retrieval — GET /tournaments/:id/scores?session=n', () => {
  it('returns scores for a session ordered by totalPins DESC for open format', async () => {
    const res = await request(app)
      .get(`/api/tournaments/${tournamentId}/scores?session=1`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    // Player 2 has more raw pins so comes first
    expect(res.body[0].playerId).toBe(playerTwoId);
    expect(res.body[1].playerId).toBe(playerOneId);
    expect(res.body[0].totalPins).toBeGreaterThanOrEqual(res.body[1].totalPins);
  });

  it('returns enriched player and team names', async () => {
    const res = await request(app)
      .get(`/api/tournaments/${tournamentId}/scores?session=1`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toHaveProperty('playerName');
    expect(res.body[0]).toHaveProperty('teamName');
    expect(res.body[0]).toHaveProperty('sessionAverage');
    expect(res.body[0]).toHaveProperty('sessionNumber', 1);
  });

  it('returns 400 when session query param is missing', async () => {
    const res = await request(app)
      .get(`/api/tournaments/${tournamentId}/scores`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/session/i);
  });
});

describe('Pins-based standings', () => {
  it('returns standings ranked by totalPins for an open/pins tournament', async () => {
    const res = await request(app)
      .get(`/api/tournaments/${tournamentId}/standings`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].rank).toBe(1);
    expect(res.body[0].playerId).toBe(playerTwoId);
    expect(res.body[0]).toHaveProperty('totalPins');
    expect(res.body[0]).toHaveProperty('tournamentAverage');
    expect(res.body[0]).toHaveProperty('sessionsPlayed');
  });

  it('returns points-based standings for a paired/points tournament', async () => {
    const res = await request(app)
      .get(`/api/tournaments/${matchplayTournamentId}/standings`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('totalPoints');
      expect(res.body[0]).not.toHaveProperty('totalPins');
    }
  });
});

describe('Handicap recalculation', () => {
  it('updates current_handicap in player_statistics after a session score', async () => {
    const res = await request(app)
      .get(`/api/tournaments/${tournamentId}/players/${playerOneId}/statistics`);

    expect(res.status).toBe(200);
    // avg 180 → FLOOR((220-180)*0.90) = 36
    expect(res.body).toHaveProperty('currentHandicap', P1_HDCP);
  });

  it('applies the recalculated handicap to the next session score', async () => {
    await request(app).post(`/api/tournaments/${tournamentId}/sessions`)
      .send({ sessionNumber: 2, sessionName: 'Week 2', sessionDate: '2026-04-14' });

    const res = await request(app)
      .post(`/api/tournaments/${tournamentId}/scores`)
      .send({ sessionNumber: 2, playerId: playerOneId, teamId: soloTeamOneId, ...P1_GAMES });

    expect(res.status).toBe(201);
    expect(res.body.handicapApplied).toBe(P1_HDCP);
    expect(res.body.totalPins).toBe(P1_TOTAL);
  });
});
