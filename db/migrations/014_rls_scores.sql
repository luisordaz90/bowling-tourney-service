-- Migration 014: Row Level Security for the scores table
--
-- Mirrors the RLS pattern established in migration 010 for all team-owned tables.
-- SELECT is open so standings, statistics, and match reads work without special-casing.
-- INSERT/UPDATE/DELETE are fenced to the team that owns the row via app.current_team_id.
--
-- Depends on: 013_unify_scores.sql

ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores FORCE  ROW LEVEL SECURITY;

CREATE POLICY scores_select ON scores
  FOR SELECT USING (true);

CREATE POLICY scores_insert ON scores
  FOR INSERT WITH CHECK (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY scores_update ON scores
  FOR UPDATE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY scores_delete ON scores
  FOR DELETE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );
