-- Migration 010: Auth0 org linkage + Row Level Security
--
-- Design:
--   - teams.auth0_org_id stores the Auth0 Organization ID (e.g. org_abc123)
--     used for admin/provisioning purposes; the JWT carries our internal teams.id
--     directly as a custom claim so runtime lookups are not needed.
--
-- RLS strategy:
--   - All writes on team-owned rows are fenced to the calling team's UUID,
--     read via the transaction-scoped variable app.current_team_id.
--   - SELECTs are intentionally kept open on most tables so that JOINs,
--     standings queries, and match result reads continue to work without
--     per-query special-casing.
--   - FORCE ROW LEVEL SECURITY ensures the table owner (non-superuser app role)
--     is also subject to policies. The postgres superuser always bypasses RLS,
--     which is correct for the migration runner and admin tooling.
--
-- The application sets the variable at the start of every transaction via:
--   SET LOCAL app.current_team_id = '<uuid>';
-- SET LOCAL resets automatically on COMMIT/ROLLBACK, so it never leaks
-- across requests even when pooled connections are reused.

-- ─── 1. Link teams table to Auth0 Organizations ──────────────────────────────

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS auth0_org_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_teams_auth0_org_id ON teams(auth0_org_id);

COMMENT ON COLUMN teams.auth0_org_id IS
  'Auth0 Organization ID (org_*) linked to this team. '
  'The corresponding org metadata stores our internal teams.id as team_id.';

-- ─── 2. Enable RLS on team-owned tables ──────────────────────────────────────

ALTER TABLE teams                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams                  FORCE  ROW LEVEL SECURITY;

ALTER TABLE tournament_teams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_teams       FORCE  ROW LEVEL SECURITY;

ALTER TABLE team_players           ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_players           FORCE  ROW LEVEL SECURITY;

ALTER TABLE player_match_scores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_match_scores    FORCE  ROW LEVEL SECURITY;

ALTER TABLE team_match_scores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_match_scores      FORCE  ROW LEVEL SECURITY;

ALTER TABLE team_statistics        ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_statistics        FORCE  ROW LEVEL SECURITY;

ALTER TABLE team_league_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_league_violations FORCE  ROW LEVEL SECURITY;

-- ─── 3. Helper expression ─────────────────────────────────────────────────────
-- current_setting('app.current_team_id', true) returns NULL when the variable
-- is not set (missing_ok=true). NULLIF guards against the empty-string edge
-- case on older Postgres versions. The ::UUID cast then produces NULL, making
-- equality checks FALSE — so uncontextualised writes are safely rejected.

-- ─── 4. RLS policies — teams ─────────────────────────────────────────────────
-- SELECT is open: the app joins on teams freely (standings, match results, etc.)
-- Writes are fenced to the owning team.

CREATE POLICY teams_select ON teams
  FOR SELECT USING (true);

CREATE POLICY teams_insert ON teams
  FOR INSERT WITH CHECK (
    id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY teams_update ON teams
  FOR UPDATE USING (
    id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY teams_delete ON teams
  FOR DELETE USING (
    id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

-- ─── 5. RLS policies — tournament_teams ──────────────────────────────────────

CREATE POLICY tournament_teams_select ON tournament_teams
  FOR SELECT USING (true);

CREATE POLICY tournament_teams_insert ON tournament_teams
  FOR INSERT WITH CHECK (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY tournament_teams_update ON tournament_teams
  FOR UPDATE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY tournament_teams_delete ON tournament_teams
  FOR DELETE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

-- ─── 6. RLS policies — team_players ──────────────────────────────────────────

CREATE POLICY team_players_select ON team_players
  FOR SELECT USING (true);

CREATE POLICY team_players_insert ON team_players
  FOR INSERT WITH CHECK (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY team_players_update ON team_players
  FOR UPDATE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY team_players_delete ON team_players
  FOR DELETE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

-- ─── 7. RLS policies — player_match_scores ───────────────────────────────────

CREATE POLICY player_match_scores_select ON player_match_scores
  FOR SELECT USING (true);

CREATE POLICY player_match_scores_insert ON player_match_scores
  FOR INSERT WITH CHECK (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY player_match_scores_update ON player_match_scores
  FOR UPDATE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY player_match_scores_delete ON player_match_scores
  FOR DELETE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

-- ─── 8. RLS policies — team_match_scores ─────────────────────────────────────

CREATE POLICY team_match_scores_select ON team_match_scores
  FOR SELECT USING (true);

CREATE POLICY team_match_scores_insert ON team_match_scores
  FOR INSERT WITH CHECK (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY team_match_scores_update ON team_match_scores
  FOR UPDATE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY team_match_scores_delete ON team_match_scores
  FOR DELETE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

-- ─── 9. RLS policies — team_statistics ───────────────────────────────────────

CREATE POLICY team_statistics_select ON team_statistics
  FOR SELECT USING (true);

CREATE POLICY team_statistics_insert ON team_statistics
  FOR INSERT WITH CHECK (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY team_statistics_update ON team_statistics
  FOR UPDATE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY team_statistics_delete ON team_statistics
  FOR DELETE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

-- ─── 10. RLS policies — team_league_violations ───────────────────────────────

CREATE POLICY team_league_violations_select ON team_league_violations
  FOR SELECT USING (true);

CREATE POLICY team_league_violations_insert ON team_league_violations
  FOR INSERT WITH CHECK (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY team_league_violations_update ON team_league_violations
  FOR UPDATE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );

CREATE POLICY team_league_violations_delete ON team_league_violations
  FOR DELETE USING (
    team_id = NULLIF(current_setting('app.current_team_id', true), '')::UUID
  );
