-- Migration 012: Solo tournament format support
--
-- Adds two new dimensions to tournaments:
--   schedule_type  — 'paired' (matchups generated) | 'open' (everyone bowls, no pairings)
--   ranking_method — 'points' (4-pt matchplay breakdown) | 'pins' (cumulative total pins)
--
-- Individual / solo competitions are handled by registering solo teams (team_type = 'solo',
-- added in migration 011) — no separate participant_type dimension is needed.
--
-- For 'paired' tournaments (any ranking_method):
--   Existing matches + player_match_scores + calculate_match_points() infrastructure
--   is reused as-is. Solo teams plug in without modification.
--
-- For 'open' tournaments (ranking_method = 'pins' only):
--   No match pairings are generated. Scores are recorded via the new session_entries
--   table. Standings are derived from cumulative total_pins across session_entries.
--
-- Also adds:
--   hdcp_base, hdcp_percentage   — configurable handicap formula params per tournament
--   player_statistics.current_handicap — tournament-scoped handicap, refreshed after each session
--   session_entries table        — per-team per-session scores for open format
--   recalculate_player_hdcp()    — trigger function
--   trg_recalculate_hdcp         — AFTER INSERT trigger on session_entries
--
-- Depends on: tournaments (003), league_sessions (005), players (001),
--             teams (001), player_statistics (007)


-- ─── 1. Tournament format columns ─────────────────────────────────────────────

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS schedule_type    VARCHAR(20)  NOT NULL DEFAULT 'paired'
    CHECK (schedule_type  IN ('paired', 'open')),
  ADD COLUMN IF NOT EXISTS ranking_method   VARCHAR(20)  NOT NULL DEFAULT 'points'
    CHECK (ranking_method IN ('points', 'pins')),
  ADD COLUMN IF NOT EXISTS hdcp_base        INTEGER      NOT NULL DEFAULT 220,
  ADD COLUMN IF NOT EXISTS hdcp_percentage  DECIMAL(4,2) NOT NULL DEFAULT 0.90,
  ADD CONSTRAINT chk_open_requires_pins
    CHECK (NOT (schedule_type = 'open' AND ranking_method = 'points'));

COMMENT ON COLUMN tournaments.schedule_type IS
  'paired = head-to-head matchups generated per session (round-robin or manual); '
  'open   = no pairings, all registered teams bowl simultaneously and are ranked by pins';

COMMENT ON COLUMN tournaments.ranking_method IS
  'points = 4-pt matchplay breakdown via calculate_match_points() — requires paired; '
  'pins   = cumulative total_pins across all sessions determines standings';

COMMENT ON COLUMN tournaments.hdcp_base IS
  'Base average used in handicap formula: FLOOR((hdcp_base - avg) * hdcp_percentage). '
  'Common values: 200, 210, 220. Configurable per tournament.';

COMMENT ON COLUMN tournaments.hdcp_percentage IS
  'Percentage factor in handicap formula. Common values: 0.80, 0.90. '
  'Configurable per tournament.';


-- ─── 2. Tournament-scoped handicap on player_statistics ───────────────────────

ALTER TABLE player_statistics
  ADD COLUMN IF NOT EXISTS current_handicap INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN player_statistics.current_handicap IS
  'Per-game handicap the player carries into their next session, derived from their '
  'running raw average in this tournament. Recalculated automatically by '
  'trg_recalculate_hdcp after each session_entries INSERT.';


-- ─── 3. session_entries table (open format only) ──────────────────────────────

CREATE TABLE IF NOT EXISTS session_entries (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id        UUID         NOT NULL REFERENCES league_sessions(id) ON DELETE CASCADE,
    tournament_id     UUID         NOT NULL REFERENCES tournaments(id)     ON DELETE CASCADE,
    player_id         UUID         NOT NULL REFERENCES players(id),
    team_id           UUID                  REFERENCES teams(id),
    game1_score       INTEGER      NOT NULL CHECK (game1_score  BETWEEN 0 AND 300),
    game2_score       INTEGER      NOT NULL CHECK (game2_score  BETWEEN 0 AND 300),
    game3_score       INTEGER      NOT NULL CHECK (game3_score  BETWEEN 0 AND 300),
    -- Per-game handicap carried in from player_statistics.current_handicap at time of entry
    handicap_applied  INTEGER      NOT NULL DEFAULT 0,
    -- total_pins includes hdcp contribution: raw pins + (handicap_applied * 3)
    total_pins        INTEGER      GENERATED ALWAYS AS
                        (game1_score + game2_score + game3_score + (handicap_applied * 3)) STORED,
    -- session_average is raw only — used to compute running tournament average
    session_average   DECIMAL(5,2) GENERATED ALWAYS AS
                        (ROUND((game1_score + game2_score + game3_score)::DECIMAL / 3, 2)) STORED,
    recorded_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_session_entries_session_id    ON session_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_session_entries_tournament_id ON session_entries(tournament_id);
CREATE INDEX IF NOT EXISTS idx_session_entries_player_id     ON session_entries(player_id);
CREATE INDEX IF NOT EXISTS idx_session_entries_team_id       ON session_entries(team_id);

COMMENT ON TABLE  session_entries                  IS 'Per-player per-session scores for open format tournaments. One row per player per session.';
COMMENT ON COLUMN session_entries.handicap_applied IS 'Per-game hdcp used for this session — read from player_statistics.current_handicap before submitting.';
COMMENT ON COLUMN session_entries.total_pins       IS 'Raw pins + (handicap_applied * 3). Used for session ranking and standings.';
COMMENT ON COLUMN session_entries.session_average  IS 'Raw average for this session (no hdcp). Summed across sessions to derive tournament running average.';


-- ─── 4. Trigger function ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recalculate_player_hdcp()
RETURNS TRIGGER AS $$
DECLARE
    v_hdcp_base     INTEGER;
    v_hdcp_pct      DECIMAL(4,2);
    v_sessions      INTEGER;
    v_raw_pins      INTEGER;
    v_new_average   DECIMAL(5,2);
    v_new_handicap  INTEGER;
BEGIN
    -- Pull handicap formula params from the tournament
    SELECT hdcp_base, hdcp_percentage
    INTO   v_hdcp_base, v_hdcp_pct
    FROM   tournaments
    WHERE  id = NEW.tournament_id;

    -- Sum raw pins across all sessions for this player in this tournament.
    -- The just-inserted row is already visible (AFTER INSERT).
    SELECT COUNT(*),
           SUM(game1_score + game2_score + game3_score)
    INTO   v_sessions, v_raw_pins
    FROM   session_entries
    WHERE  tournament_id = NEW.tournament_id
      AND  player_id     = NEW.player_id;

    v_new_average  := ROUND(v_raw_pins::DECIMAL / (v_sessions * 3), 2);
    -- GREATEST(0, ...) — above-base bowlers receive 0 hdcp, not negative pins
    v_new_handicap := GREATEST(0, FLOOR((v_hdcp_base - v_new_average) * v_hdcp_pct));

    -- Upsert player_statistics — current_handicap is what the player
    -- carries into their next session entry
    INSERT INTO player_statistics (
        player_id, tournament_id, team_id,
        games_played, total_pins, current_average,
        matches_played, current_handicap, last_updated
    ) VALUES (
        NEW.player_id, NEW.tournament_id, NEW.team_id,
        v_sessions * 3, v_raw_pins, v_new_average,
        v_sessions, v_new_handicap, CURRENT_TIMESTAMP
    )
    ON CONFLICT (player_id, tournament_id, team_id) DO UPDATE SET
        games_played     = v_sessions * 3,
        total_pins       = v_raw_pins,
        current_average  = v_new_average,
        matches_played   = v_sessions,
        current_handicap = v_new_handicap,
        last_updated     = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_player_hdcp() IS
  'Fired AFTER INSERT on session_entries. Recomputes the player''s running raw average '
  'across all sessions in the tournament and derives a new per-game handicap using the '
  'tournament''s hdcp_base and hdcp_percentage. Upserts player_statistics so that '
  'current_handicap reflects what the player carries into their next session.';


-- ─── 5. Trigger ───────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_recalculate_hdcp ON session_entries;

CREATE TRIGGER trg_recalculate_hdcp
    AFTER INSERT ON session_entries
    FOR EACH ROW
    EXECUTE FUNCTION recalculate_player_hdcp();
