// tests/player-invite.test.js
// TDD tests for player invitation flow
const request = require('supertest');
const { query } = require('../config/database');

// Override the auth0-management module before loading the app
const management = require('../config/auth0-management');
const mockUsersCreate = vi.fn();
management.users.create = mockUsersCreate;

// Mock global fetch for the password reset email call
const originalFetch = global.fetch;
const mockFetch = vi.fn();
global.fetch = mockFetch;

const app = require('../server');

beforeEach(() => {
  mockUsersCreate.mockReset();
  mockFetch.mockReset();

  let callCount = 0;
  mockUsersCreate.mockImplementation(() => {
    callCount++;
    return Promise.resolve({ data: { user_id: `auth0|test-user-${Date.now()}-${callCount}` } });
  });
  mockFetch.mockResolvedValue({ ok: true, text: async () => 'We just sent you an email' });
});

describe('POST /api/players (invite flow)', () => {
  it('rejects regular player from creating a player', async () => {
    const res = await request(app)
      .post('/api/players')
      .set('X-User-Role', 'player')
      .send({ name: 'New Player', email: 'new@example.com' });
    expect(res.status).toBe(403);
  });

  it('allows superadmin to create a player with Auth0 invitation', async () => {
    const res = await request(app)
      .post('/api/players')
      .set('X-User-Role', 'superadmin')
      .send({ name: 'Invited Player', email: 'invited@example.com' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('status', 'invited');
    expect(res.body).toHaveProperty('auth0UserId');
    expect(res.body.auth0UserId).toMatch(/^auth0\|test-user-/);
    expect(mockUsersCreate).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify Auth0 create call includes player_id in app_metadata
    const createCall = mockUsersCreate.mock.calls[0][0];
    expect(createCall).toHaveProperty('email', 'invited@example.com');
    expect(createCall).toHaveProperty('name', 'Invited Player');
    expect(createCall.app_metadata).toHaveProperty('player_id');
    expect(createCall.email_verified).toBe(true);
    expect(createCall.verify_email).toBe(false);
  });

  it('requires name and email', async () => {
    const res = await request(app)
      .post('/api/players')
      .set('X-User-Role', 'superadmin')
      .send({ name: 'No Email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('returns 500 if Auth0 user creation fails', async () => {
    mockUsersCreate.mockRejectedValue(new Error('Auth0 error'));

    const res = await request(app)
      .post('/api/players')
      .set('X-User-Role', 'superadmin')
      .send({ name: 'Fail Player', email: 'fail@example.com' });
    expect(res.status).toBe(500);
  });

  it('stores player with invited status in DB', async () => {
    const res = await request(app)
      .post('/api/players')
      .set('X-User-Role', 'superadmin')
      .send({ name: 'DB Check Player', email: 'dbcheck@example.com' });

    expect(res.status).toBe(201);
    const dbResult = await query('SELECT status, auth0_user_id FROM players WHERE id = $1', [res.body.id]);
    expect(dbResult.rows[0].status).toBe('invited');
    expect(dbResult.rows[0].auth0_user_id).toMatch(/^auth0\|test-user-/);
  });
});
