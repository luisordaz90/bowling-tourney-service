-- Migration: Add Leagues and Tournament Editions
-- This migration adds the concept of leagues and tournament editions/seasons

-- Create leagues table
CREATE TABLE IF NOT EXISTS leagues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    league_type VARCHAR(50) DEFAULT 'standard', -- standard, youth, senior, etc.
    status VARCHAR(20) DEFAULT 'active', -- active, inactive, archived
    max_teams_per_tournament INTEGER DEFAULT NULL, -- null means no limit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create tournament_editions table to track different seasons/editions of tournaments
CREATE TABLE IF NOT EXISTS tournament_editions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    edition_number INTEGER NOT NULL, -- 1, 2, 3, etc. for each edition
    name VARCHAR(255) NOT NULL, -- e.g., "Spring 2024", "Fall League Season 1"
    season VARCHAR(50), -- spring, summer, fall, winter
    year INTEGER NOT NULL,
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    max_teams INTEGER DEFAULT NULL,
    total_sessions INTEGER DEFAULT 1,
    session_type VARCHAR(50) DEFAULT 'weekly',
    sessions_completed INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft', -- draft, active, completed, cancelled
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(league_id, edition_number), -- Ensure unique edition numbers per league
    UNIQUE(league_id, name) -- Ensure unique names per league
);

-- Add league_id and edition_id to tournaments table
ALTER TABLE tournaments 
ADD COLUMN IF NOT EXISTS league_id UUID REFERENCES leagues(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS edition_id UUID REFERENCES tournament_editions(id) ON DELETE SET NULL;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_leagues_status ON leagues(status);
CREATE INDEX IF NOT EXISTS idx_leagues_name ON leagues(name);
CREATE INDEX IF NOT EXISTS idx_tournament_editions_league_id ON tournament_editions(league_id);
CREATE INDEX IF NOT EXISTS idx_tournament_editions_year_season ON tournament_editions(year, season);
CREATE INDEX IF NOT EXISTS idx_tournament_editions_status ON tournament_editions(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_league_id ON tournaments(league_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_edition_id ON tournaments(edition_id);

-- Create player_league_eligibility table to track player eligibility rules
CREATE TABLE IF NOT EXISTS player_league_eligibility (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'eligible', -- eligible, suspended, banned
    reason TEXT, -- reason for suspension/ban
    effective_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expiry_date TIMESTAMP, -- null means permanent
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(player_id, league_id)
);

-- Create team_league_violations table to track rule violations
CREATE TABLE IF NOT EXISTS team_league_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    edition_id UUID REFERENCES tournament_editions(id) ON DELETE CASCADE,
    player_id UUID REFERENCES players(id) ON DELETE CASCADE,
    violation_type VARCHAR(50) NOT NULL, -- multiple_teams, ineligible_player, etc.
    description TEXT NOT NULL,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'open' -- open, resolved, dismissed
);

-- Add indexes for eligibility and violations
CREATE INDEX IF NOT EXISTS idx_player_league_eligibility_player_id ON player_league_eligibility(player_id);
CREATE INDEX IF NOT EXISTS idx_player_league_eligibility_league_id ON player_league_eligibility(league_id);
CREATE INDEX IF NOT EXISTS idx_team_league_violations_team_id ON team_league_violations(team_id);
CREATE INDEX IF NOT EXISTS idx_team_league_violations_league_id ON team_league_violations(league_id);
CREATE INDEX IF NOT EXISTS idx_team_league_violations_status ON team_league_violations(status);

-- Insert some sample leagues for testing
INSERT INTO leagues (name, description, league_type, max_teams_per_tournament) VALUES
('Main Bowling League', 'Primary competitive bowling league', 'standard', 16),
('Youth League', 'League for players under 18', 'youth', 12),
('Senior League', 'League for players 55 and over', 'senior', 10)
ON CONFLICT (name) DO NOTHING;

-- Function to validate player team assignments within a league
CREATE OR REPLACE FUNCTION validate_player_team_assignment()
RETURNS TRIGGER AS $$
DECLARE
    league_id_var UUID;
    existing_team_count INTEGER;
BEGIN
    -- Get the league_id for this tournament
    SELECT t.league_id INTO league_id_var
    FROM tournaments t
    WHERE t.id = NEW.tournament_id;
    
    -- If no league is associated, allow the assignment
    IF league_id_var IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Check if player is already on another team in the same league for active tournaments
    SELECT COUNT(*) INTO existing_team_count
    FROM team_players tp
    JOIN tournaments t ON tp.tournament_id = t.id
    WHERE tp.player_id = NEW.player_id
    AND tp.team_id != NEW.team_id
    AND tp.is_active = true
    AND t.league_id = league_id_var
    AND t.status IN ('active', 'draft');
    
    IF existing_team_count > 0 THEN
        RAISE EXCEPTION 'Player is already assigned to another team in this league for an active tournament';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce the validation
DROP TRIGGER IF EXISTS validate_player_team_assignment_trigger ON team_players;
CREATE TRIGGER validate_player_team_assignment_trigger
    BEFORE INSERT OR UPDATE ON team_players
    FOR EACH ROW
    EXECUTE FUNCTION validate_player_team_assignment();

-- Add comments for documentation
COMMENT ON TABLE leagues IS 'Bowling leagues that organize multiple tournament editions';
COMMENT ON TABLE tournament_editions IS 'Different seasons/editions of tournaments within a league';
COMMENT ON TABLE player_league_eligibility IS 'Track player eligibility status for specific leagues';
COMMENT ON TABLE team_league_violations IS 'Log violations of league rules for auditing';
COMMENT ON FUNCTION validate_player_team_assignment() IS 'Ensures players cannot be on multiple teams in the same league simultaneously';