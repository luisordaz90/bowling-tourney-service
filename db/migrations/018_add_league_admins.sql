-- Migration: Create league_admins table
-- Stores which players are assigned as admins for specific leagues.
-- The league_admin role itself comes from the JWT claim; this table scopes the assignment.

CREATE TABLE IF NOT EXISTS league_admins (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  assigned_by UUID REFERENCES players(id) ON DELETE SET NULL,
  PRIMARY KEY (player_id, league_id)
);

CREATE INDEX IF NOT EXISTS idx_league_admins_league ON league_admins (league_id);
