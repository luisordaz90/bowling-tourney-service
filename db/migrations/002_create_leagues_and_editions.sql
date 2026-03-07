-- Migration 002: Create leagues and tournament_editions tables
-- leagues is independent; tournament_editions depends on leagues.

CREATE TABLE IF NOT EXISTS leagues (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                      VARCHAR(255) NOT NULL UNIQUE,
    description               TEXT,
    league_type               VARCHAR(50) DEFAULT 'standard' CHECK (league_type IN ('standard', 'youth', 'senior')),
    status                    VARCHAR(20)  DEFAULT 'active'  CHECK (status IN ('active', 'inactive', 'archived')),
    max_teams_per_tournament  INTEGER,   -- NULL means no limit
    created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leagues_status ON leagues(status);
CREATE INDEX IF NOT EXISTS idx_leagues_name   ON leagues(name);

COMMENT ON TABLE  leagues                           IS 'Top-level organising body that groups multiple tournament editions';
COMMENT ON COLUMN leagues.max_teams_per_tournament  IS 'Soft cap enforced at the tournament level; NULL means unlimited';


CREATE TABLE IF NOT EXISTS tournament_editions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id           UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    edition_number      INTEGER NOT NULL,
    name                VARCHAR(255) NOT NULL,
    season              VARCHAR(50)  CHECK (season IN ('spring', 'summer', 'fall', 'winter')),
    year                INTEGER NOT NULL,
    start_date          TIMESTAMP NOT NULL,
    end_date            TIMESTAMP NOT NULL,
    max_teams           INTEGER,
    total_sessions      INTEGER DEFAULT 1,
    session_type        VARCHAR(50) DEFAULT 'weekly',
    sessions_completed  INTEGER DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (league_id, edition_number),
    UNIQUE (league_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tournament_editions_league_id     ON tournament_editions(league_id);
CREATE INDEX IF NOT EXISTS idx_tournament_editions_year_season   ON tournament_editions(year, season);
CREATE INDEX IF NOT EXISTS idx_tournament_editions_status        ON tournament_editions(status);

COMMENT ON TABLE  tournament_editions                IS 'A season or edition of a league (e.g. "Spring 2024", "Season 3")';
COMMENT ON COLUMN tournament_editions.edition_number IS 'Sequential number within the league; unique per league';


-- Seed leagues used during development
INSERT INTO leagues (name, description, league_type, max_teams_per_tournament) VALUES
    ('Main Bowling League', 'Primary competitive bowling league', 'standard', 16),
    ('Youth League',        'League for players under 18',        'youth',    12),
    ('Senior League',       'League for players 55 and over',     'senior',   10)
ON CONFLICT (name) DO NOTHING;
