// tests/rbac.test.js
// TDD tests for Phase 2: resolveRoles + authorize middleware, league admin endpoints
const request = require('supertest');
const app = require('../server');
const { query } = require('../config/database');

let superadminId;
let leagueAdminId;
let regularPlayerId;
let leagueId;
let tournamentId;
let teamId;

beforeAll(async () => {
  // Create players for each role
  const sa = await request(app)
    .post('/api/players')
    .send({ name: 'RBAC Superadmin', email: 'rbac-sa@example.com' });
  superadminId = sa.body.id;

  const la = await request(app)
    .post('/api/players')
    .send({ name: 'RBAC League Admin', email: 'rbac-la@example.com' });
  leagueAdminId = la.body.id;

  const rp = await request(app)
    .post('/api/players')
    .send({ name: 'RBAC Regular Player', email: 'rbac-rp@example.com' });
  regularPlayerId = rp.body.id;

  // Fetch a league
  const leaguesRes = await request(app).get('/api/leagues');
  leagueId = leaguesRes.body[0].id;

  // Create a team
  const teamRes = await request(app)
    .post('/api/teams')
    .send({ name: 'RBAC Test Team', captainName: 'Cap', captainEmail: 'rbac-cap@test.com' });
  teamId = teamRes.body.id;
});

// --- resolveRoles middleware ---

describe('resolveRoles middleware', () => {
  it('sets role to superadmin when X-User-Role header is superadmin', async () => {
    const res = await request(app)
      .get('/api/me/teams')
      .set('X-Player-Id', superadminId)
      .set('X-User-Role', 'superadmin');
    // Should succeed — superadmin can access any endpoint
    expect(res.status).toBe(200);
  });

  it('sets role to league_admin and loads adminOfLeagues from DB', async () => {
    // Insert a league_admins row
    await query(
      'INSERT INTO league_admins (player_id, league_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [leagueAdminId, leagueId, superadminId]
    );

    const res = await request(app)
      .get('/api/me/teams')
      .set('X-Player-Id', leagueAdminId)
      .set('X-User-Role', 'league_admin');
    expect(res.status).toBe(200);
  });

  it('defaults to player role when no X-User-Role header', async () => {
    const res = await request(app)
      .get('/api/me/teams')
      .set('X-Player-Id', regularPlayerId);
    expect(res.status).toBe(200);
  });
});

// --- authorize middleware ---

describe('authorize middleware on league endpoints', () => {
  it('allows superadmin to create a league', async () => {
    const res = await request(app)
      .post('/api/leagues')
      .set('X-Player-Id', superadminId)
      .set('X-User-Role', 'superadmin')
      .send({ name: 'RBAC Test League', leagueType: 'standard' });
    expect(res.status).toBe(201);
  });

  it('rejects regular player from creating a league', async () => {
    const res = await request(app)
      .post('/api/leagues')
      .set('X-Player-Id', regularPlayerId)
      .set('X-User-Role', 'player')
      .send({ name: 'Unauthorized League', leagueType: 'standard' });
    expect(res.status).toBe(403);
  });

  it('allows league admin to update their scoped league', async () => {
    const res = await request(app)
      .put(`/api/leagues/${leagueId}`)
      .set('X-Player-Id', leagueAdminId)
      .set('X-User-Role', 'league_admin')
      .send({ description: 'Updated by league admin' });
    expect(res.status).toBe(200);
  });

  it('rejects league admin from updating a league they do not administer', async () => {
    // Create another league as superadmin
    const newLeague = await request(app)
      .post('/api/leagues')
      .set('X-Player-Id', superadminId)
      .set('X-User-Role', 'superadmin')
      .send({ name: 'Other RBAC League', leagueType: 'standard' });
    const otherLeagueId = newLeague.body.id;

    const res = await request(app)
      .put(`/api/leagues/${otherLeagueId}`)
      .set('X-Player-Id', leagueAdminId)
      .set('X-User-Role', 'league_admin')
      .send({ description: 'Should fail' });
    expect(res.status).toBe(403);
  });

  it('rejects regular player from updating a league', async () => {
    const res = await request(app)
      .put(`/api/leagues/${leagueId}`)
      .set('X-Player-Id', regularPlayerId)
      .set('X-User-Role', 'player')
      .send({ description: 'Should fail' });
    expect(res.status).toBe(403);
  });
});

describe('authorize middleware on tournament endpoints', () => {
  it('allows superadmin to create a tournament', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .set('X-Player-Id', superadminId)
      .set('X-User-Role', 'superadmin')
      .send({
        name: 'RBAC Tournament',
        startDate: '2026-09-01',
        endDate: '2026-12-01',
        maxTeams: 8,
        totalSessions: 7,
        sessionType: 'weekly',
        leagueId,
      });
    expect(res.status).toBe(201);
    tournamentId = res.body.id;
  });

  it('allows league admin to create tournament in their league', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .set('X-Player-Id', leagueAdminId)
      .set('X-User-Role', 'league_admin')
      .send({
        name: 'LA Tournament',
        startDate: '2026-09-01',
        endDate: '2026-12-01',
        maxTeams: 8,
        totalSessions: 7,
        sessionType: 'weekly',
        leagueId,
      });
    expect(res.status).toBe(201);
  });

  it('rejects regular player from creating a tournament', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .set('X-Player-Id', regularPlayerId)
      .set('X-User-Role', 'player')
      .send({
        name: 'Unauthorized Tournament',
        startDate: '2026-09-01',
        endDate: '2026-12-01',
        maxTeams: 8,
        totalSessions: 7,
        sessionType: 'weekly',
        leagueId,
      });
    expect(res.status).toBe(403);
  });
});

// --- League admin management endpoints ---

describe('POST /api/leagues/:leagueId/admins', () => {
  it('allows superadmin to assign a league admin', async () => {
    // Create a new player to assign
    const newPlayer = await request(app)
      .post('/api/players')
      .send({ name: 'New League Admin', email: 'new-la@example.com' });

    const res = await request(app)
      .post(`/api/leagues/${leagueId}/admins`)
      .set('X-Player-Id', superadminId)
      .set('X-User-Role', 'superadmin')
      .send({ playerId: newPlayer.body.id });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('playerId');
    expect(res.body).toHaveProperty('leagueId');
  });

  it('rejects non-superadmin from assigning league admins', async () => {
    const res = await request(app)
      .post(`/api/leagues/${leagueId}/admins`)
      .set('X-Player-Id', leagueAdminId)
      .set('X-User-Role', 'league_admin')
      .send({ playerId: regularPlayerId });
    expect(res.status).toBe(403);
  });

  it('returns 409 when player is already a league admin', async () => {
    const res = await request(app)
      .post(`/api/leagues/${leagueId}/admins`)
      .set('X-Player-Id', superadminId)
      .set('X-User-Role', 'superadmin')
      .send({ playerId: leagueAdminId });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/leagues/:leagueId/admins/:playerId', () => {
  it('allows superadmin to remove a league admin', async () => {
    const res = await request(app)
      .delete(`/api/leagues/${leagueId}/admins/${leagueAdminId}`)
      .set('X-Player-Id', superadminId)
      .set('X-User-Role', 'superadmin');
    expect(res.status).toBe(200);

    // Verify removal
    const check = await query(
      'SELECT * FROM league_admins WHERE player_id = $1 AND league_id = $2',
      [leagueAdminId, leagueId]
    );
    expect(check.rows.length).toBe(0);
  });

  it('rejects non-superadmin from removing league admins', async () => {
    const res = await request(app)
      .delete(`/api/leagues/${leagueId}/admins/${regularPlayerId}`)
      .set('X-Player-Id', leagueAdminId)
      .set('X-User-Role', 'league_admin');
    expect(res.status).toBe(403);
  });
});
