-- Migration: Remove denormalized stats columns from players table.
-- These are stale — real stats live in player_statistics (per tournament).

ALTER TABLE players DROP COLUMN IF EXISTS handicap;
ALTER TABLE players DROP COLUMN IF EXISTS average_score;
ALTER TABLE players DROP COLUMN IF EXISTS total_games_played;
ALTER TABLE players DROP COLUMN IF EXISTS total_pins;
