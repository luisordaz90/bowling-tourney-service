-- Migration 022: Add lineup_size to tournaments
--
-- lineup_size = number of players each team fields per game.
-- Used by match completion check instead of full roster count,
-- which allows substitutions (more players than lineup_size can
-- have scores in a single match).
--
-- Depends on: tournaments (003)

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS lineup_size INTEGER NOT NULL DEFAULT 3;

COMMENT ON COLUMN tournaments.lineup_size IS
  'Number of players each team fields per game within a session. '
  'Substitutions may cause more distinct players to score in a match, '
  'but the total score rows per team should equal lineup_size * games_per_session.';
