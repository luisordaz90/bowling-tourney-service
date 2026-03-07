-- Migration 004: Create tournament_teams and team_players tables
-- These are the registration join tables that scope teams and players to a tournament.
-- Depends on: players (001), teams (001), tournaments (003)

-- ------------------------------------------------------------
-- tournament_teams
-- Records which teams are competing in a given tournament.
-- This is the source of truth used by the schedule generator.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournament_teams (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id                   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id                         UUID NOT NULL REFERENCES teams(id)       ON DELETE CASCADE,
    seed_number                     INTEGER,
    status                          VARCHAR(20) DEFAULT 'registered' CHECK (status IN ('registered', 'withdrawn')),
    -- Denormalized running totals (informational; canonical stats live in team_statistics)
    total_tournament_score          INTEGER DEFAULT 0,
    games_played_in_tournament      INTEGER DEFAULT 0,
    sessions_played_in_tournament   INTEGER DEFAULT 0,
    registration_date               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tournament_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_teams_tournament_id ON tournament_teams(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_teams_team_id       ON tournament_teams(team_id);
CREATE INDEX IF NOT EXISTS idx_tournament_teams_status        ON tournament_teams(status);

COMMENT ON TABLE  tournament_teams                             IS 'Registers a team into a tournament; the basis for match generation';
COMMENT ON COLUMN tournament_teams.seed_number                 IS 'Used to order teams in the round-robin circle algorithm';
COMMENT ON COLUMN tournament_teams.total_tournament_score      IS 'Denormalized; canonical aggregate is in team_statistics';
COMMENT ON COLUMN tournament_teams.games_played_in_tournament  IS 'Denormalized; canonical aggregate is in team_statistics';


-- ------------------------------------------------------------
-- team_players
-- Records which players are on which team for a given tournament.
-- Player-team membership is tournament-scoped, not global.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_players (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID NOT NULL REFERENCES teams(id)       ON DELETE CASCADE,
    player_id       UUID NOT NULL REFERENCES players(id)     ON DELETE CASCADE,
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    role            VARCHAR(20) DEFAULT 'regular' CHECK (role IN ('captain', 'regular', 'substitute')),
    is_active       BOOLEAN DEFAULT true,
    joined_date     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    left_date       TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_players_team_id       ON team_players(team_id);
CREATE INDEX IF NOT EXISTS idx_team_players_player_id     ON team_players(player_id);
CREATE INDEX IF NOT EXISTS idx_team_players_tournament_id ON team_players(tournament_id);
CREATE INDEX IF NOT EXISTS idx_team_players_is_active     ON team_players(is_active);

COMMENT ON TABLE  team_players             IS 'Scopes a player to a team within a specific tournament';
COMMENT ON COLUMN team_players.is_active   IS 'False when a player has been removed mid-tournament but their scores remain';
COMMENT ON COLUMN team_players.left_date   IS 'Set when is_active is flipped to false';
