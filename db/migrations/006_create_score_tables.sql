-- Migration 006: Create player_match_scores, team_match_scores, and match_points tables
-- This is the active, database-backed scoring system.
-- Depends on: players (001), teams (001), matches (005)

-- ------------------------------------------------------------
-- player_match_scores
-- Individual player scores for a single match.
-- Always records three game scores (a standard bowling series).
-- One row per player per match; insertion is prevented if a
-- score already exists for that (match_id, player_id) pair.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_match_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id         UUID NOT NULL REFERENCES teams(id),
    player_id       UUID NOT NULL REFERENCES players(id),
    game1_score     INTEGER NOT NULL CHECK (game1_score >= 0 AND game1_score <= 300),
    game2_score     INTEGER NOT NULL CHECK (game2_score >= 0 AND game2_score <= 300),
    game3_score     INTEGER NOT NULL CHECK (game3_score >= 0 AND game3_score <= 300),
    handicap_applied INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_match_scores_match_id  ON player_match_scores(match_id);
CREATE INDEX IF NOT EXISTS idx_player_match_scores_player_id ON player_match_scores(player_id);
CREATE INDEX IF NOT EXISTS idx_player_match_scores_team_id   ON player_match_scores(team_id);

COMMENT ON TABLE  player_match_scores                  IS 'Per-player three-game series for a match; one row per player per match';
COMMENT ON COLUMN player_match_scores.handicap_applied IS 'Handicap pins added on top of raw game scores';


-- ------------------------------------------------------------
-- team_match_scores
-- Aggregated team-level score for a match.
-- Calculated by the calculateTeamScoreInMatch endpoint which
-- sums all player_match_scores for that team.
-- One row per team per match.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_match_scores (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id            UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id             UUID NOT NULL REFERENCES teams(id),
    total_team_score    INTEGER NOT NULL,
    total_handicap      INTEGER DEFAULT 0,
    team_average        DECIMAL(6,2),
    games_played        INTEGER,
    recorded_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (match_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_team_match_scores_match_id ON team_match_scores(match_id);
CREATE INDEX IF NOT EXISTS idx_team_match_scores_team_id  ON team_match_scores(team_id);

COMMENT ON TABLE  team_match_scores              IS 'Aggregated team score computed from player_match_scores; one row per team per match';
COMMENT ON COLUMN team_match_scores.team_average IS 'Average score per game across all players in the match';


-- ------------------------------------------------------------
-- match_points
-- Point breakdown per match, calculated by calculate_match_points().
-- Awards 1 point per game won + 1 series point = 4 points max.
-- Exactly one row per match (enforced by UNIQUE on match_id).
-- Created/updated automatically when both team scores are recorded.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_points (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id            UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE UNIQUE,
    home_team_id        UUID NOT NULL REFERENCES teams(id),
    away_team_id        UUID NOT NULL REFERENCES teams(id),
    -- Home team point breakdown
    home_game1_points   INTEGER DEFAULT 0 CHECK (home_game1_points IN (0, 1)),
    home_game2_points   INTEGER DEFAULT 0 CHECK (home_game2_points IN (0, 1)),
    home_game3_points   INTEGER DEFAULT 0 CHECK (home_game3_points IN (0, 1)),
    home_series_points  INTEGER DEFAULT 0 CHECK (home_series_points IN (0, 1)),
    home_total_points   INTEGER DEFAULT 0 CHECK (home_total_points BETWEEN 0 AND 4),
    -- Away team point breakdown
    away_game1_points   INTEGER DEFAULT 0 CHECK (away_game1_points IN (0, 1)),
    away_game2_points   INTEGER DEFAULT 0 CHECK (away_game2_points IN (0, 1)),
    away_game3_points   INTEGER DEFAULT 0 CHECK (away_game3_points IN (0, 1)),
    away_series_points  INTEGER DEFAULT 0 CHECK (away_series_points IN (0, 1)),
    away_total_points   INTEGER DEFAULT 0 CHECK (away_total_points BETWEEN 0 AND 4),
    calculated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_match_points_match_id     ON match_points(match_id);
CREATE INDEX IF NOT EXISTS idx_match_points_home_team_id ON match_points(home_team_id);
CREATE INDEX IF NOT EXISTS idx_match_points_away_team_id ON match_points(away_team_id);

COMMENT ON TABLE  match_points               IS '4-point breakdown per completed match; populated by calculate_match_points()';
COMMENT ON COLUMN match_points.home_total_points IS '1 pt per game won + 1 series pt; max 4 per match';
