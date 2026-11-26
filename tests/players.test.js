// tests/players.test.js
// PUT /api/players/:id — profile updates and player:update permission
const request = require('supertest');
const app = require('../server');

let playerId;
let otherPlayerId;

beforeAll(async () => {
  const p = await request(app)
    .post('/api/players')
    .send({ name: 'Update Target', email: 'update-target@example.com' });
  playerId = p.body.id;

  const o = await request(app)
    .post('/api/players')
    .send({ name: 'Other Player', email: 'update-other@example.com' });
  otherPlayerId = o.body.id;
});

describe('PUT /api/players/:id', () => {
  it('lets a superadmin update a player', async () => {
    const res = await request(app)
      .put(`/api/players/${playerId}`)
      .set('X-User-Role', 'superadmin')
      .send({ name: 'Updated Name', phone: '555-0100' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(playerId);
    expect(res.body.name).toBe('Updated Name');
    expect(res.body.phone).toBe('555-0100');
  });

  it('returns camelCase fields', async () => {
    const res = await request(app)
      .put(`/api/players/${playerId}`)
      .send({ phone: '555-0101' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('updatedAt');
    expect(res.body).not.toHaveProperty('updated_at');
  });

  it('lets a player update their own profile', async () => {
    const res = await request(app)
      .put(`/api/players/${playerId}`)
      .set('X-Player-Id', playerId)
      .set('X-User-Role', 'player')
      .send({ name: 'Self Edited' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Self Edited');
  });

  it("rejects a player updating someone else's profile", async () => {
    const res = await request(app)
      .put(`/api/players/${otherPlayerId}`)
      .set('X-Player-Id', playerId)
      .set('X-User-Role', 'player')
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 for an invalid email', async () => {
    const res = await request(app)
      .put(`/api/players/${playerId}`)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('returns 400 when no fields are provided', async () => {
    const res = await request(app)
      .put(`/api/players/${playerId}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown player', async () => {
    const res = await request(app)
      .put('/api/players/00000000-0000-0000-0000-000000000000')
      .send({ name: 'Nobody' });
    expect(res.status).toBe(404);
  });
});
