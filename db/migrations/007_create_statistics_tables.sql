-- Migration 007: Create team_statistics and player_statistics tables
-- Rolled-up performance aggregates per entity per tournament.
-- Depends on: players (001), teams (001), tournaments (003)

-- ------------------------------------------------------------
-- team_statistics
-- Cumulative team performance for a tournament.
-- Upserted automatically by calculateTeamScoreInMatch whenever
-- a match completes (both team scores submitted and points calculated).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_statistics (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id                 UUID NOT NULL REFERENCES teams(id)       ON DELETE CASCADE,
    tournament_id           UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    total_matches_played    INTEGER DEFAULT 0,
    matches_won             INTEGER DEFAULT 0,
    matches_lost            INTEGER DEFAULT 0,
    total_team_score        INTEGER DEFAULT 0,
    team_average            DECIMAL(6,2) DEFAULT 0,
    total_points            INTEGER DEFAULT 0,
    points_percentage       DECIMAL(5,2) DEFAULT 0,
    rank_position           INTEGER,
    last_updated            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (team_id, tournament_id)
);

CREATE INDEX IF NOT EXISTS idx_team_statistics_team_id       ON team_statistics(team_id);
CREATE INDEX IF NOT EXISTS idx_team_statistics_tournament_id ON team_statistics(tournament_id);
CREATE INDEX IF NOT EXISTS idx_team_statistics_total_points  ON team_statistics(total_points DESC);

COMMENT ON TABLE  team_statistics                   IS 'Rolled-up team performance per tournament; upserted on each completed match';
COMMENT ON COLUMN team_statistics.total_points      IS 'Cumulative match_points earned across all completed matches';
COMMENT ON COLUMN team_statistics.points_percentage IS 'total_points / (total_matches_played * 4) * 100; max 100';
COMMENT ON COLUMN team_statistics.rank_position     IS 'Snapshot rank; the tournament_standings view computes live rank';


-- ------------------------------------------------------------
-- player_statistics
-- Cumulative player performance for a tournament, scoped by team.
-- NOTE: Not auto-updated on score submission — must be updated
-- manually via PUT /api/player-statistics/:id/:tournamentId,
-- or derived on-the-fly from the player_performance view.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_statistics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id       UUID NOT NULL REFERENCES players(id)     ON DELETE CASCADE,
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id         UUID       REFERENCES teams(id)          ON DELETE SET NULL,
    games_played    INTEGER DEFAULT 0,
    total_pins      INTEGER DEFAULT 0,
    current_average DECIMAL(5,2) DEFAULT 0,
    highest_game    INTEGER DEFAULT 0,
    highest_series  INTEGER DEFAULT 0,
    matches_played  INTEGER DEFAULT 0,
    last_updated    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (player_id, tournament_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_player_statistics_player_id     ON player_statistics(player_id);
CREATE INDEX IF NOT EXISTS idx_player_statistics_tournament_id ON player_statistics(tournament_id);
CREATE INDEX IF NOT EXISTS idx_player_statistics_team_id       ON player_statistics(team_id);

COMMENT ON TABLE  player_statistics IS 'Rolled-up player performance per tournament and team; see also player_performance view for live data';
