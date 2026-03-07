-- Migration 003: Create tournaments table
-- Depends on: leagues (002), tournament_editions (002)

CREATE TABLE IF NOT EXISTS tournaments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    start_date          TIMESTAMP NOT NULL,
    end_date            TIMESTAMP NOT NULL,
    max_teams           INTEGER NOT NULL,
    total_sessions      INTEGER NOT NULL,
    session_type        VARCHAR(50) NOT NULL,
    sessions_completed  INTEGER DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
    -- League/edition linkage is optional: a tournament can exist outside a league
    league_id           UUID REFERENCES leagues(id) ON DELETE SET NULL,
    edition_id          UUID REFERENCES tournament_editions(id) ON DELETE SET NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tournaments_status     ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_league_id  ON tournaments(league_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_edition_id ON tournaments(edition_id);

COMMENT ON TABLE  tournaments              IS 'A single tournament event, optionally associated with a league and edition';
COMMENT ON COLUMN tournaments.session_type IS 'Frequency of sessions, e.g. "weekly"';
COMMENT ON COLUMN tournaments.league_id   IS 'Optional link to a parent league; SET NULL on league deletion';
COMMENT ON COLUMN tournaments.edition_id  IS 'Optional link to the specific season/edition within the league';
