-- Migration 008: Create league eligibility and violation tracking tables
-- Depends on: players (001), teams (001), leagues (002), tournament_editions (002)

-- ------------------------------------------------------------
-- player_league_eligibility
-- Tracks whether a player is allowed to compete in a league.
-- One row per (player, league) pair; status can be updated
-- without creating a new row.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_league_eligibility (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    status          VARCHAR(20) DEFAULT 'eligible' CHECK (status IN ('eligible', 'suspended', 'banned')),
    reason          TEXT,
    effective_date  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expiry_date     TIMESTAMP,  -- NULL means the status is permanent
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (player_id, league_id)
);

CREATE INDEX IF NOT EXISTS idx_player_league_eligibility_player_id ON player_league_eligibility(player_id);
CREATE INDEX IF NOT EXISTS idx_player_league_eligibility_league_id ON player_league_eligibility(league_id);
CREATE INDEX IF NOT EXISTS idx_player_league_eligibility_status    ON player_league_eligibility(status);

COMMENT ON TABLE  player_league_eligibility             IS 'Eligibility status of a player within a specific league';
COMMENT ON COLUMN player_league_eligibility.expiry_date IS 'NULL = permanent; non-null = status expires on this date';


-- ------------------------------------------------------------
-- team_league_violations
-- Audit log of rule violations for a team within a league.
-- Used to track incidents such as ineligible player usage or
-- double-teaming across league editions.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_league_violations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    edition_id      UUID       REFERENCES tournament_editions(id) ON DELETE SET NULL,
    player_id       UUID       REFERENCES players(id)    ON DELETE SET NULL,
    violation_type  VARCHAR(50) NOT NULL,
    description     TEXT NOT NULL,
    detected_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at     TIMESTAMP,
    status          VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_team_league_violations_team_id   ON team_league_violations(team_id);
CREATE INDEX IF NOT EXISTS idx_team_league_violations_league_id ON team_league_violations(league_id);
CREATE INDEX IF NOT EXISTS idx_team_league_violations_status    ON team_league_violations(status);

COMMENT ON TABLE  team_league_violations                IS 'Audit log of rule violations; violations persist even after resolution';
COMMENT ON COLUMN team_league_violations.violation_type IS 'e.g. "multiple_teams", "ineligible_player", "roster_manipulation"';
COMMENT ON COLUMN team_league_violations.player_id      IS 'The specific player involved, if applicable; SET NULL on player deletion';


-- ------------------------------------------------------------
-- Trigger: validate_player_team_assignment
-- Prevents a player from being on two different teams in the
-- same league for any concurrent active/draft tournament.
-- Fires on INSERT or UPDATE of team_players.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_player_team_assignment()
RETURNS TRIGGER AS $$
DECLARE
    v_league_id          UUID;
    existing_team_count  INTEGER;
BEGIN
    -- Resolve the league this tournament belongs to
    SELECT t.league_id INTO v_league_id
    FROM tournaments t
    WHERE t.id = NEW.tournament_id;

    -- If the tournament has no league, allow the assignment freely
    IF v_league_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Check whether the player is already on a *different* team within
    -- any active or draft tournament in this same league
    SELECT COUNT(*) INTO existing_team_count
    FROM team_players  tp
    JOIN tournaments   t  ON tp.tournament_id = t.id
    WHERE tp.player_id  = NEW.player_id
      AND tp.team_id   <> NEW.team_id
      AND tp.is_active  = true
      AND t.league_id   = v_league_id
      AND t.status      IN ('active', 'draft');

    IF existing_team_count > 0 THEN
        RAISE EXCEPTION 'Player is already assigned to another team in this league for an active tournament';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_player_team_assignment() IS
    'Enforces the one-team-per-league rule: a player cannot be on two different teams within the same league simultaneously';

DROP TRIGGER IF EXISTS validate_player_team_assignment_trigger ON team_players;
CREATE TRIGGER validate_player_team_assignment_trigger
    BEFORE INSERT OR UPDATE ON team_players
    FOR EACH ROW
    EXECUTE FUNCTION validate_player_team_assignment();
