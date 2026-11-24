// config/auth0-management.js
// Auth0 Management API client for user provisioning (invitation flow).
// In test env, this module is mocked — see tests/player-invite.test.js.

if (process.env.NODE_ENV === 'test') {
  const { randomUUID } = require('crypto');
  // Default test stub — returns plausible data so existing tests work.
  // player-invite.test.js overrides these with vi.fn() for assertions.
  module.exports = {
    users: { create: async () => ({ data: { user_id: `auth0|test-${randomUUID()}` } }) },
  };
} else {
  const { ManagementClient } = require('auth0');

  module.exports = new ManagementClient({
    domain: process.env.AUTH0_DOMAIN,
    clientId: process.env.AUTH0_MGMT_CLIENT_ID,
    clientSecret: process.env.AUTH0_MGMT_CLIENT_SECRET,
  });
}
