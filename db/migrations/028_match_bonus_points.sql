-- Migration 028: Add bonus points to match_points and backfill Patorneo
--
-- Bonus categories (attendance, uniform, payment) are per-team per-match.
-- Stored as JSONB: {"attendance": 1, "uniform": 1, "payment": 1}
-- Total bonus is summed and added to the team's total_points for the match.


-- ─── 1. Add bonus columns to match_points ──────────────────────────────────────

ALTER TABLE match_points
  ADD COLUMN IF NOT EXISTS home_bonus_points JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS away_bonus_points JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN match_points.home_bonus_points IS
  'Per-category bonus points for home team. E.g. {"attendance":1,"uniform":1,"payment":1}';
COMMENT ON COLUMN match_points.away_bonus_points IS
  'Per-category bonus points for away team. E.g. {"attendance":1,"uniform":1,"payment":1}';


-- ─── 2. Drop old check constraints before updating totals ───────────────────────

ALTER TABLE match_points DROP CONSTRAINT IF EXISTS match_points_home_total_points_check;
ALTER TABLE match_points DROP CONSTRAINT IF EXISTS match_points_away_total_points_check;

ALTER TABLE match_points
  ADD CONSTRAINT match_points_home_total_points_check CHECK (home_total_points >= 0),
  ADD CONSTRAINT match_points_away_total_points_check CHECK (away_total_points >= 0);


-- ─── 3. Update Patorneo scoring_config ─────────────────────────────────────────

UPDATE tournaments
SET scoring_config = jsonb_set(
  scoring_config,
  '{points,bonus_categories}',
  '["attendance", "uniform", "payment"]'::jsonb
)
WHERE name = '28 Edicion';


-- ─── 3. Backfill all existing Patorneo matches with full bonuses ────────────────

-- Every team gets all 3 bonus points (1 each) for all 6 sessions played
UPDATE match_points mp
SET home_bonus_points = '{"attendance": 1, "uniform": 1, "payment": 1}'::jsonb,
    away_bonus_points = '{"attendance": 1, "uniform": 1, "payment": 1}'::jsonb,
    home_total_points = home_total_points + 3,
    away_total_points = away_total_points + 3
FROM matches m
JOIN tournaments t ON m.tournament_id = t.id
WHERE mp.match_id = m.id
  AND t.name = '28 Edicion';


-- ─── 4. Update team_statistics: +3 points per match played ─────────────────────

UPDATE team_statistics ts
SET total_points = total_points + (total_matches_played * 3),
    -- Recalculate points_percentage with new max (games + series + bonuses = 3+1+3 = 7)
    points_percentage = CASE WHEN total_matches_played > 0
      THEN ROUND((((total_points + total_matches_played * 3)::DECIMAL) / (total_matches_played * 7)) * 100, 2)
      ELSE 0 END,
    last_updated = CURRENT_TIMESTAMP
WHERE tournament_id = (SELECT id FROM tournaments WHERE name = '28 Edicion');


