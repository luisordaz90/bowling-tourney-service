-- Migration: Add status and auth0_user_id to players table
-- Supports the invitation flow: admin creates player → Auth0 user created → player logs in

ALTER TABLE players ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE players ADD COLUMN IF NOT EXISTS auth0_user_id TEXT;

-- Existing players are already active
UPDATE players SET status = 'active' WHERE status IS NULL;

ALTER TABLE players ADD CONSTRAINT players_auth0_user_id_unique UNIQUE (auth0_user_id);

CREATE INDEX idx_players_status ON players (status);
