// tests/e2e-persona-flows.test.js
// Two-persona E2E: Maria (league admin) and Carlos (team captain).
// Maria creates a league + tournament, registers teams, generates schedule,
// opens a session, and submits scores.
// Carlos (player on one of the teams) views his dashboard, teams, leagues,
// statistics, and standings.
const request = require('supertest');
const app = require('../server');
const { query, closePool } = require('../config/database');

afterAll(async () => {
  await closePool();
});

// ── Fixture helpers ─────────────────────────────────────────────────────────

const post = (path, body, headers = {}) =>
  request(app).post(path).set(headers).send(body);

const get = (path, headers = {}) =>
  request(app).get(path).set(headers);

const superadminHeaders = (playerId) => ({
  'X-Player-Id': playerId,
  'X-User-Role': 'superadmin',
});

const adminHeaders = (playerId) => ({
  'X-Player-Id': playerId,
  'X-User-Role': 'league_admin',
});

const playerHeaders = (playerId) => ({
  'X-Player-Id': playerId,
  'X-User-Role': 'player',
});

// ── Shared state ────────────────────────────────────────────────────────────

const ids = {
  maria: null,
  carlos: null,
  league: null,
  tournament: null,
  teams: [],       // [{ id, players: [{ id, email }] }]
  sessions: [],
  matches: [],
};

// Two teams, 3 players each
const TEAM_DEFS = [
  {
    name: 'Los Bolicheros',
    captain: { name: 'Carlos', email: 'carlos@persona.test' },
    players: [
      { name: 'Carlos', email: 'carlos@persona.test' },
      { name: 'Lucia', email: 'lucia@persona.test' },
      { name: 'Miguel', email: 'miguel@persona.test' },
    ],
  },
  {
    name: 'Pin Destroyers',
    captain: { name: 'Elena', email: 'elena@persona.test' },
    players: [
      { name: 'Elena', email: 'elena@persona.test' },
      { name: 'Jorge', email: 'jorge@persona.test' },
      { name: 'Sofia', email: 'sofia@persona.test' },
    ],
  },
];

// Scores per player email per session: [g1, g2, g3]
const SESSION_SCORES = {
  0: {
    'carlos@persona.test': [180, 175, 190],
    'lucia@persona.test': [160, 155, 165],
    'miguel@persona.test': [145, 150, 140],
    'elena@persona.test': [170, 180, 175],
    'jorge@persona.test': [155, 160, 150],
    'sofia@persona.test': [140, 145, 135],
  },
  1: {
    'carlos@persona.test': [190, 185, 195],
    'lucia@persona.test': [165, 170, 160],
    'miguel@persona.test': [150, 155, 148],
    'elena@persona.test': [175, 172, 180],
    'jorge@persona.test': [160, 158, 165],
    'sofia@persona.test': [142, 148, 138],
  },
};

// ── Phase 1: Maria sets up the league ───────────────────────────────────────

describe('Maria (league admin) — setup', () => {
  it('creates Maria as a player', async () => {
    // player:create requires superadmin or league_admin
    const res = await post('/api/players', {
      name: 'Maria Admin',
      email: 'maria@persona.test',
    }, superadminHeaders('temp'));
    expect(res.status).toBe(201);
    ids.maria = res.body.id;
  });

  it('creates a league (superadmin) and assigns Maria as admin', async () => {
    // league:create requires superadmin
    const res = await post('/api/leagues', {
      name: 'Persona Test League',
      leagueType: 'standard',
    }, superadminHeaders(ids.maria));
    expect(res.status).toBe(201);
    ids.league = res.body.id;

    // Assign Maria as league admin
    await query(
      'INSERT INTO league_admins (player_id, league_id, assigned_by) VALUES ($1, $2, $1)',
      [ids.maria, ids.league]
    );
  });

  it('creates a paired tournament as league admin', async () => {
    const res = await post('/api/tournaments', {
      name: 'Persona Fall 2026',
      leagueId: ids.league,
      startDate: '2026-09-01',
      endDate: '2026-12-15',
      maxTeams: 8,
      totalSessions: 2,
      sessionType: 'weekly',
      scheduleType: 'paired',
      rankingMethod: 'points',
      gamesPerSession: 3,
      hdcpBase: 220,
      hdcpPercentage: 80,
      season: 'fall',
      year: 2026,
    }, adminHeaders(ids.maria));
    expect(res.status).toBe(201);
    ids.tournament = res.body.id;
  });

  it('creates all players', async () => {
    const allPlayers = TEAM_DEFS.flatMap(t => t.players);
    // Deduplicate by email
    const seen = new Set();
    for (const p of allPlayers) {
      if (seen.has(p.email)) continue;
      seen.add(p.email);

      const res = await post('/api/players', p, adminHeaders(ids.maria));
      expect(res.status).toBe(201);

      // Map player IDs back to team defs
      for (const team of TEAM_DEFS) {
        for (const tp of team.players) {
          if (tp.email === p.email) tp.id = res.body.id;
        }
      }

      if (p.email === 'carlos@persona.test') {
        ids.carlos = res.body.id;
      }
    }
    expect(ids.carlos).toBeTruthy();
  });

  it('creates teams, registers them, and adds players to rosters', async () => {
    for (const def of TEAM_DEFS) {
      // Create team
      const teamRes = await post('/api/teams', {
        name: def.name,
        captainName: def.captain.name,
        captainEmail: def.captain.email,
      });
      expect(teamRes.status).toBe(201);

      const team = { id: teamRes.body.id, players: [] };

      // Register team for tournament
      const regRes = await post('/api/registrations/teams', {
        tournamentId: ids.tournament,
        teamId: team.id,
      }, adminHeaders(ids.maria));
      expect(regRes.status).toBe(201);

      // Add players to roster
      for (const p of def.players) {
        const addRes = await post('/api/registrations/players', {
          tournamentId: ids.tournament,
          teamId: team.id,
          playerId: p.id,
        }, adminHeaders(ids.maria));
        expect(addRes.status).toBe(201);

        team.players.push({ id: p.id, email: p.email });
      }

      ids.teams.push(team);
    }

    expect(ids.teams).toHaveLength(2);
  });
});

// ── Phase 2: Maria generates schedule and submits scores ────────────────────

describe('Maria (league admin) — schedule & scoring', () => {
  it('generates a round-robin schedule', async () => {
    const res = await post(
      `/api/schedule/generate?tournamentId=${ids.tournament}`,
      { totalSessions: 2 },
      adminHeaders(ids.maria)
    );
    expect(res.status).toBe(201);

    // Fetch sessions
    const sessionsRes = await get(
      `/api/sessions?tournamentId=${ids.tournament}`,
      adminHeaders(ids.maria)
    );
    expect(sessionsRes.status).toBe(200);
    ids.sessions = sessionsRes.body.map(s => s.id);
    expect(ids.sessions.length).toBeGreaterThanOrEqual(1);
  });

  it('submits scores for both sessions', async () => {
    // Fetch session numbers
    const sessionsRes = await get(
      `/api/sessions?tournamentId=${ids.tournament}`,
      adminHeaders(ids.maria)
    );

    for (let i = 0; i < sessionsRes.body.length; i++) {
      const session = sessionsRes.body[i];
      const scores = SESSION_SCORES[i];
      if (!scores) continue;

      for (const team of ids.teams) {
        for (const player of team.players) {
          const playerScores = scores[player.email];
          if (!playerScores) continue;

          const scoreRes = await post(
            `/api/scores`,
            {
              tournamentId: ids.tournament,
              sessionNumber: session.sessionNumber,
              playerId: player.id,
              teamId: team.id,
              scores: playerScores,
            },
            adminHeaders(ids.maria)
          );
          expect(scoreRes.status).toBe(201);
        }
      }
    }
  });
});

// ── Phase 3: Carlos views his data ──────────────────────────────────────────

describe('Carlos (team captain) — player experience', () => {
  it('sees his teams via /api/me/teams', async () => {
    const res = await get('/api/me/teams', playerHeaders(ids.carlos));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const team = res.body.find(t => t.id === ids.teams[0].id);
    expect(team).toBeDefined();
    expect(team.leagueId).toBe(ids.league);
  });

  it('sees his leagues via /api/me/leagues', async () => {
    const res = await get('/api/me/leagues', playerHeaders(ids.carlos));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.some(l => l.id === ids.league)).toBe(true);
  });

  it('gets a full dashboard via /api/me/dashboard', async () => {
    const res = await get('/api/me/dashboard', playerHeaders(ids.carlos));
    expect(res.status).toBe(200);

    expect(res.body.player).toBeDefined();
    expect(res.body.player.name).toBe('Carlos');
    expect(res.body.currentTeams.length).toBeGreaterThanOrEqual(1);
    expect(res.body.recentScores.length).toBeGreaterThanOrEqual(1);

    // Career stats should reflect submitted scores
    const stats = res.body.overallStatistics;
    expect(Number(stats.totalGames)).toBeGreaterThan(0);
    expect(Number(stats.totalPins)).toBeGreaterThan(0);
  });

  it('sees per-tournament statistics via /api/me/statistics', async () => {
    const res = await get(
      `/api/me/statistics?tournamentId=${ids.tournament}`,
      playerHeaders(ids.carlos)
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const stat = res.body[0];
    expect(Number(stat.gamesPlayed)).toBeGreaterThan(0);
    expect(Number(stat.currentAverage)).toBeGreaterThan(0);
  });

  it('views tournament standings (empty — team_statistics not auto-populated)', async () => {
    // team_statistics is now auto-populated by tryCompleteMatch when both
    // teams in a match have all scores submitted.
    const res = await get(
      `/api/standings?tournamentId=${ids.tournament}`,
      playerHeaders(ids.carlos)
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('views league history', async () => {
    const res = await get('/api/me/league-history', playerHeaders(ids.carlos));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.some(h => h.leagueId === ids.league)).toBe(true);
  });
});

// ── Phase 4: Admin-only actions are blocked for Carlos ──────────────────────

describe('Carlos (player) — access control', () => {
  it('cannot create a tournament', async () => {
    const res = await post('/api/tournaments', {
      name: 'Unauthorized Tournament',
      leagueId: ids.league,
      startDate: '2027-01-01',
      endDate: '2027-06-01',
      maxTeams: 8,
      totalSessions: 4,
      sessionType: 'weekly',
      scheduleType: 'paired',
      rankingMethod: 'points',
      gamesPerSession: 3,
    }, playerHeaders(ids.carlos));
    expect(res.status).toBe(403);
  });

  it('cannot generate a schedule', async () => {
    const res = await post(
      `/api/schedule/generate?tournamentId=${ids.tournament}`,
      { totalSessions: 1 },
      playerHeaders(ids.carlos)
    );
    expect(res.status).toBe(403);
  });
});
