-- Migration 001: Create players and teams tables
-- These are the two foundational entity tables with no foreign key dependencies.

CREATE TABLE IF NOT EXISTS players (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    email               VARCHAR(255),
    phone               VARCHAR(50),
    handicap            INTEGER DEFAULT 0,
    average_score       DECIMAL(5,2) DEFAULT 0,
    total_games_played  INTEGER DEFAULT 0,
    total_pins          INTEGER DEFAULT 0,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_players_name  ON players(name);
CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);

COMMENT ON TABLE  players                    IS 'Individual bowler profiles, independent of any team or tournament';
COMMENT ON COLUMN players.handicap           IS 'Player handicap applied to scores during league play';
COMMENT ON COLUMN players.average_score      IS 'Running average updated inline on every score submission';
COMMENT ON COLUMN players.total_games_played IS 'Cumulative games across all tournaments';
COMMENT ON COLUMN players.total_pins         IS 'Cumulative pin total across all tournaments';


CREATE TABLE IF NOT EXISTS teams (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL UNIQUE,
    captain_name    VARCHAR(255),
    captain_email   VARCHAR(255),
    captain_phone   VARCHAR(50),
    status          VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teams_name   ON teams(name);
CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(status);

COMMENT ON TABLE teams IS 'Team entities that exist independently of any tournament';
