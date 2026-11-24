-- Migration 017: Simplify domain model
--
-- 1. Rename league_sessions → tournament_sessions
-- 2. Add season/year to tournaments (replaces edition concept)
-- 3. Drop tournament_editions table and all edition_id references
-- 4. Make tournaments.league_id NOT NULL
-- 5. Add one-active-tournament-per-league constraint

-- ─── 1. Rename league_sessions → tournament_sessions ─────────────────────────

ALTER TABLE league_sessions RENAME TO tournament_sessions;

ALTER INDEX idx_league_sessions_tournament_id RENAME TO idx_tournament_sessions_tournament_id;
ALTER INDEX idx_league_sessions_status RENAME TO idx_tournament_sessions_status;
ALTER INDEX idx_league_sessions_session_number RENAME TO idx_tournament_sessions_session_number;

-- ─── 2. Add season and year to tournaments ───────────────────────────────────

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS season VARCHAR(20),
  ADD COLUMN IF NOT EXISTS year INTEGER;

COMMENT ON COLUMN tournaments.season IS 'Season label, e.g. spring, fall, summer, winter';
COMMENT ON COLUMN tournaments.year IS 'Year of the tournament, e.g. 2026';

-- ─── 3. Drop edition references ──────────────────────────────────────────────

-- Drop edition_id from team_league_violations
ALTER TABLE team_league_violations DROP COLUMN IF EXISTS edition_id;

-- Drop edition_id from tournaments (index + column; FK drops with column)
DROP INDEX IF EXISTS idx_tournaments_edition_id;
ALTER TABLE tournaments DROP COLUMN IF EXISTS edition_id;

-- Drop the tournament_editions table
DROP TABLE IF EXISTS tournament_editions;

-- ─── 4. Make league_id NOT NULL ──────────────────────────────────────────────

-- Safety backfill: assign orphan tournaments to first available league
UPDATE tournaments
SET league_id = (SELECT id FROM leagues ORDER BY created_at LIMIT 1)
WHERE league_id IS NULL
  AND EXISTS (SELECT 1 FROM leagues);

ALTER TABLE tournaments ALTER COLUMN league_id SET NOT NULL;

-- ─── 5. One active tournament per league ─────────────────────────────────────

CREATE UNIQUE INDEX idx_one_active_tournament_per_league
  ON tournaments (league_id)
  WHERE status = 'active';

COMMENT ON INDEX idx_one_active_tournament_per_league IS
  'Ensures a league can only have one active tournament at a time.';
