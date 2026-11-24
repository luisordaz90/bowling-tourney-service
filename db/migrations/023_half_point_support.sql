-- Migration 023: Support half-point values from tied games
--
-- The 4-point system splits tied games 0.5/0.5 and tied series 0.5/0.5.
-- Several INTEGER columns truncated these to 0 or 1. This migration
-- changes them to NUMERIC(3,1) (match_points) / NUMERIC(5,1) (team_statistics)
-- and fixes the one known affected match (Session 6: Automotriz vs Boliche GDL).


-- ─── 1. match_points: series points ────────────────────────────────────────────

-- Drop old CHECK constraints that only allowed 0 or 1
ALTER TABLE match_points DROP CONSTRAINT IF EXISTS match_points_home_series_points_check;
ALTER TABLE match_points DROP CONSTRAINT IF EXISTS match_points_away_series_points_check;

-- Change type from INTEGER to NUMERIC(3,1)
ALTER TABLE match_points
  ALTER COLUMN home_series_points TYPE NUMERIC(3,1) USING home_series_points::NUMERIC(3,1),
  ALTER COLUMN away_series_points TYPE NUMERIC(3,1) USING away_series_points::NUMERIC(3,1);

-- New CHECK allows 0, 0.5, or 1
ALTER TABLE match_points
  ADD CONSTRAINT match_points_home_series_points_check CHECK (home_series_points IN (0, 0.5, 1)),
  ADD CONSTRAINT match_points_away_series_points_check CHECK (away_series_points IN (0, 0.5, 1));


-- ─── 2. match_points: total points ────────────────────────────────────────────

ALTER TABLE match_points DROP CONSTRAINT IF EXISTS match_points_home_total_points_check;
ALTER TABLE match_points DROP CONSTRAINT IF EXISTS match_points_away_total_points_check;

ALTER TABLE match_points
  ALTER COLUMN home_total_points TYPE NUMERIC(3,1) USING home_total_points::NUMERIC(3,1),
  ALTER COLUMN away_total_points TYPE NUMERIC(3,1) USING away_total_points::NUMERIC(3,1);

ALTER TABLE match_points
  ADD CONSTRAINT match_points_home_total_points_check CHECK (home_total_points >= 0 AND home_total_points <= 4),
  ADD CONSTRAINT match_points_away_total_points_check CHECK (away_total_points >= 0 AND away_total_points <= 4);


-- ─── 3. team_statistics: total_points ──────────────────────────────────────────

-- Drop the view that depends on team_statistics.total_points
DROP VIEW IF EXISTS tournament_standings;

-- Drop the index first (will recreate after type change)
DROP INDEX IF EXISTS idx_team_statistics_total_points;

ALTER TABLE team_statistics
  ALTER COLUMN total_points TYPE NUMERIC(5,1) USING total_points::NUMERIC(5,1);

CREATE INDEX idx_team_statistics_total_points ON team_statistics(total_points DESC);

-- Recreate the tournament_standings view
CREATE VIEW tournament_standings AS
SELECT
  ts.team_id,
  t.name AS team_name,
  t.captain_name,
  ts.tournament_id,
  ts.total_matches_played AS matches_played,
  ts.matches_won,
  ts.matches_lost,
  ts.total_team_score AS total_score,
  ts.team_average,
  ts.total_points,
  ts.points_percentage,
  CASE
    WHEN ts.total_matches_played > 0
    THEN round((ts.matches_won::numeric / ts.total_matches_played::numeric) * 100, 2)
    ELSE 0
  END AS win_percentage,
  tt.seed_number,
  tt.status,
  rank() OVER (PARTITION BY ts.tournament_id ORDER BY ts.total_points DESC, ts.total_team_score DESC) AS current_rank
FROM team_statistics ts
JOIN teams t ON ts.team_id = t.id
JOIN tournament_teams tt ON ts.team_id = tt.team_id AND ts.tournament_id = tt.tournament_id;


-- ─── 4. Fix Session 6 tied match: Automotriz 2.5 – 1.5 Boliche GDL ────────────

-- match_points: correct from 2-2 to 2.5-1.5
UPDATE match_points
SET home_total_points = 2.5,
    away_total_points = 1.5
WHERE match_id = 'd0538c6e-e0c2-4078-b14f-606667b96918';

-- team_statistics: Automotriz gained 0.5 less than it should have (+0.5)
UPDATE team_statistics
SET total_points = total_points + 0.5
WHERE team_id = (SELECT id FROM teams WHERE name = 'AUTOMOTRIZ DEL AHORRO')
  AND tournament_id = (SELECT id FROM tournaments WHERE name = '28 Edicion');

-- team_statistics: Boliche GDL gained 0.5 more than it should have (-0.5)
UPDATE team_statistics
SET total_points = total_points - 0.5
WHERE team_id = (SELECT id FROM teams WHERE name = 'BOLICHE GDL')
  AND tournament_id = (SELECT id FROM tournaments WHERE name = '28 Edicion');
