-- Migration 013: Unify scoring into a single 'scores' table
--
-- Replaces:  player_match_scores  (paired format — one row per player per match)
--            session_entries      (open format  — one row per player per session)
--            team_match_scores    (derived aggregate — computed on the fly instead)
--
-- New table: scores
--   One row per player per game per session/match.
--   match_id IS NULL  → open format (no head-to-head pairing)
--   match_id IS NOT NULL → paired format
--
-- Also adds:
--   tournaments.games_per_session  — configurable games per session (default 3)
--   match_points JSONB columns     — replace fixed game1/2/3 columns
--   calculate_match_points()       — rewritten for N games
--   player_performance view        — rewritten against scores
--   trg_recalculate_hdcp           — moved to scores, fires when all games submitted
--
-- Depends on: all previous migrations (001–012)


-- ─── 1. Add games_per_session to tournaments ──────────────────────────────────

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS games_per_session INTEGER NOT NULL DEFAULT 3;

COMMENT ON COLUMN tournaments.games_per_session IS
  'Number of games bowled per session. Determines how many score rows are expected '
  'per player per session and is used in handicap recalculation and point calculations.';


-- ─── 2. Create unified scores table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scores (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       UUID         NOT NULL REFERENCES league_sessions(id) ON DELETE CASCADE,
    tournament_id    UUID         NOT NULL REFERENCES tournaments(id)     ON DELETE CASCADE,
    player_id        UUID         NOT NULL REFERENCES players(id),
    team_id          UUID                  REFERENCES teams(id),
    -- NULL for open format; references a match for paired format
    match_id         UUID                  REFERENCES matches(id)         ON DELETE CASCADE,
    game_number      INTEGER      NOT NULL CHECK (game_number >= 1),
    score            INTEGER      NOT NULL CHECK (score BETWEEN 0 AND 300),
    -- Handicap carried into this session from player_statistics.current_handicap
    handicap_applied INTEGER      NOT NULL DEFAULT 0,
    -- per-game pins including handicap
    pins_with_hdcp   INTEGER      GENERATED ALWAYS AS (score + handicap_applied) STORED,
    recorded_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- One game row per player per game per session (open format)
CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_open_unique
    ON scores(session_id, player_id, game_number)
    WHERE match_id IS NULL;

-- One game row per player per game per match (paired format)
CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_paired_unique
    ON scores(match_id, player_id, game_number)
    WHERE match_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scores_session_id    ON scores(session_id);
CREATE INDEX IF NOT EXISTS idx_scores_tournament_id ON scores(tournament_id);
CREATE INDEX IF NOT EXISTS idx_scores_player_id     ON scores(player_id);
CREATE INDEX IF NOT EXISTS idx_scores_team_id       ON scores(team_id);
CREATE INDEX IF NOT EXISTS idx_scores_match_id      ON scores(match_id);

COMMENT ON TABLE  scores                  IS 'Unified per-game scores. match_id IS NULL = open format (no pairing); match_id IS NOT NULL = paired format.';
COMMENT ON COLUMN scores.game_number      IS '1-based game index within the session (1..games_per_session).';
COMMENT ON COLUMN scores.handicap_applied IS 'Per-game handicap snapshotted from player_statistics.current_handicap at submission time.';
COMMENT ON COLUMN scores.pins_with_hdcp   IS 'score + handicap_applied. Summed across all games gives the session total with handicap.';


-- ─── 3. Migrate existing data ─────────────────────────────────────────────────

-- session_entries → scores (open format, match_id = NULL)
INSERT INTO scores
    (session_id, tournament_id, player_id, team_id, match_id,
     game_number, score, handicap_applied, recorded_at)
SELECT session_id, tournament_id, player_id, team_id, NULL::UUID,
       1, game1_score, handicap_applied, recorded_at
FROM   session_entries
UNION ALL
SELECT session_id, tournament_id, player_id, team_id, NULL::UUID,
       2, game2_score, handicap_applied, recorded_at
FROM   session_entries
UNION ALL
SELECT session_id, tournament_id, player_id, team_id, NULL::UUID,
       3, game3_score, handicap_applied, recorded_at
FROM   session_entries;

-- player_match_scores → scores (paired format, match_id IS NOT NULL)
-- session_id is derived through matches; only rows where the match has a session are migrated.
INSERT INTO scores
    (session_id, tournament_id, player_id, team_id, match_id,
     game_number, score, handicap_applied, recorded_at)
SELECT m.session_id, m.tournament_id, pms.player_id, pms.team_id, pms.match_id,
       1, pms.game1_score, pms.handicap_applied, pms.created_at
FROM   player_match_scores pms
JOIN   matches m ON pms.match_id = m.id
WHERE  m.session_id IS NOT NULL
UNION ALL
SELECT m.session_id, m.tournament_id, pms.player_id, pms.team_id, pms.match_id,
       2, pms.game2_score, pms.handicap_applied, pms.created_at
FROM   player_match_scores pms
JOIN   matches m ON pms.match_id = m.id
WHERE  m.session_id IS NOT NULL
UNION ALL
SELECT m.session_id, m.tournament_id, pms.player_id, pms.team_id, pms.match_id,
       3, pms.game3_score, pms.handicap_applied, pms.created_at
FROM   player_match_scores pms
JOIN   matches m ON pms.match_id = m.id
WHERE  m.session_id IS NOT NULL;


-- ─── 4. Drop replaced tables ──────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_recalculate_hdcp ON session_entries;

DROP TABLE IF EXISTS session_entries     CASCADE;
DROP TABLE IF EXISTS team_match_scores   CASCADE;
DROP TABLE IF EXISTS player_match_scores CASCADE;


-- ─── 5. Update match_points table ─────────────────────────────────────────────

-- Replace fixed per-game columns with JSONB arrays so point breakdowns are
-- not limited to exactly 3 games.

ALTER TABLE match_points
    DROP COLUMN IF EXISTS home_game1_points,
    DROP COLUMN IF EXISTS home_game2_points,
    DROP COLUMN IF EXISTS home_game3_points,
    DROP COLUMN IF EXISTS away_game1_points,
    DROP COLUMN IF EXISTS away_game2_points,
    DROP COLUMN IF EXISTS away_game3_points;

ALTER TABLE match_points
    ADD COLUMN IF NOT EXISTS home_game_points JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS away_game_points JSONB NOT NULL DEFAULT '[]';

-- Relax the total_points range constraint (was hard-coded BETWEEN 0 AND 4)
ALTER TABLE match_points
    DROP CONSTRAINT IF EXISTS match_points_home_total_points_check,
    DROP CONSTRAINT IF EXISTS match_points_away_total_points_check;

ALTER TABLE match_points
    ADD CONSTRAINT match_points_home_total_points_check CHECK (home_total_points >= 0),
    ADD CONSTRAINT match_points_away_total_points_check CHECK (away_total_points >= 0);

COMMENT ON COLUMN match_points.home_game_points IS
    'JSONB array of per-game points for the home team. Index 0 = game 1, etc. Each element is 0 or 1.';
COMMENT ON COLUMN match_points.away_game_points IS
    'JSONB array of per-game points for the away team. Index 0 = game 1, etc. Each element is 0 or 1.';
COMMENT ON COLUMN match_points.home_total_points IS
    'Sum of home_game_points + home_series_points. Max = games_per_session + 1.';
COMMENT ON COLUMN match_points.away_total_points IS
    'Sum of away_game_points + away_series_points. Max = games_per_session + 1.';


-- ─── 6. Rewrite calculate_match_points() ──────────────────────────────────────

DROP FUNCTION IF EXISTS calculate_match_points(UUID);

CREATE OR REPLACE FUNCTION calculate_match_points(p_match_id UUID)
RETURNS TABLE (
    home_team_id    UUID,
    away_team_id    UUID,
    home_game_pts   JSONB,
    home_series_pts INTEGER,
    home_total_pts  INTEGER,
    away_game_pts   JSONB,
    away_series_pts INTEGER,
    away_total_pts  INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_home_team_id      UUID;
    v_away_team_id      UUID;
    v_tournament_id     UUID;
    v_games_per_session INTEGER;
    v_home_game_pts     JSONB    := '[]'::JSONB;
    v_away_game_pts     JSONB    := '[]'::JSONB;
    v_home_series       INTEGER  := 0;
    v_away_series       INTEGER  := 0;
    v_home_game_total   INTEGER  := 0;
    v_away_game_total   INTEGER  := 0;
    v_home_g            INTEGER;
    v_away_g            INTEGER;
    v_home_pt           INTEGER;
    v_away_pt           INTEGER;
    v_home_series_pt    INTEGER;
    v_away_series_pt    INTEGER;
    v_game              INTEGER;
BEGIN
    SELECT m.home_team_id, m.away_team_id, m.tournament_id
    INTO   v_home_team_id, v_away_team_id, v_tournament_id
    FROM   matches m
    WHERE  m.id = p_match_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Match % not found', p_match_id;
    END IF;

    SELECT t.games_per_session
    INTO   v_games_per_session
    FROM   tournaments t
    WHERE  t.id = v_tournament_id;

    FOR v_game IN 1..v_games_per_session LOOP
        SELECT COALESCE(SUM(s.score), 0)
        INTO   v_home_g
        FROM   scores s
        WHERE  s.match_id    = p_match_id
          AND  s.team_id     = v_home_team_id
          AND  s.game_number = v_game;

        SELECT COALESCE(SUM(s.score), 0)
        INTO   v_away_g
        FROM   scores s
        WHERE  s.match_id    = p_match_id
          AND  s.team_id     = v_away_team_id
          AND  s.game_number = v_game;

        v_home_series := v_home_series + v_home_g;
        v_away_series := v_away_series + v_away_g;

        v_home_pt := CASE WHEN v_home_g > v_away_g THEN 1 ELSE 0 END;
        v_away_pt := CASE WHEN v_away_g > v_home_g THEN 1 ELSE 0 END;

        v_home_game_pts   := v_home_game_pts   || to_jsonb(v_home_pt);
        v_away_game_pts   := v_away_game_pts   || to_jsonb(v_away_pt);
        v_home_game_total := v_home_game_total + v_home_pt;
        v_away_game_total := v_away_game_total + v_away_pt;
    END LOOP;

    v_home_series_pt := CASE WHEN v_home_series > v_away_series THEN 1 ELSE 0 END;
    v_away_series_pt := CASE WHEN v_away_series > v_home_series THEN 1 ELSE 0 END;

    RETURN QUERY SELECT
        v_home_team_id,
        v_away_team_id,
        v_home_game_pts,
        v_home_series_pt,
        v_home_game_total + v_home_series_pt,
        v_away_game_pts,
        v_away_series_pt,
        v_away_game_total + v_away_series_pt;
END;
$$;

COMMENT ON FUNCTION calculate_match_points(UUID) IS
    'Returns N+1 point breakdown for a match where N = tournament.games_per_session. '
    '1 pt per game won + 1 series pt. Ties award 0 to both sides. Sources from scores table.';


-- ─── 7. Rewrite player_performance view ───────────────────────────────────────

CREATE OR REPLACE VIEW player_performance AS
SELECT
    p.id                                                              AS player_id,
    p.name                                                            AS player_name,
    s.team_id,
    s.tournament_id,
    COUNT(DISTINCT s.match_id) FILTER (WHERE s.match_id IS NOT NULL) AS matches_played,
    COUNT(*)                                                          AS games_played,
    COALESCE(SUM(s.score), 0)                                        AS total_pins,
    CASE
        WHEN COUNT(*) > 0
        THEN ROUND(SUM(s.score)::DECIMAL / COUNT(*), 2)
        ELSE 0
    END                                                               AS current_average,
    COALESCE(MAX(s.score), 0)                                        AS highest_game,
    -- highest series = max total pins in a single session/match grouping
    COALESCE((
        SELECT MAX(series_total)
        FROM (
            SELECT SUM(s2.score) AS series_total
            FROM   scores s2
            WHERE  s2.player_id     = p.id
              AND  s2.tournament_id = s.tournament_id
            GROUP BY s2.session_id, s2.match_id
        ) series_agg
    ), 0)                                                             AS highest_series,
    t.name                                                            AS team_name,
    tour.name                                                         AS tournament_name
FROM      players     p
JOIN      scores      s    ON p.id            = s.player_id
JOIN      teams       t    ON s.team_id       = t.id
JOIN      tournaments tour ON s.tournament_id = tour.id
GROUP BY
    p.id, p.name,
    s.team_id,
    s.tournament_id,
    t.name, tour.name;

COMMENT ON VIEW player_performance IS
    'Live per-player per-tournament performance derived from scores table. '
    'Covers both open and paired formats.';


-- ─── 8. New trg_recalculate_hdcp on scores ────────────────────────────────────

CREATE OR REPLACE FUNCTION recalculate_player_hdcp()
RETURNS TRIGGER AS $$
DECLARE
    v_games_per_session INTEGER;
    v_games_submitted   INTEGER;
    v_hdcp_base         INTEGER;
    v_hdcp_pct          DECIMAL(4,2);
    v_sessions          INTEGER;
    v_raw_pins          INTEGER;
    v_new_average       DECIMAL(5,2);
    v_new_handicap      INTEGER;
BEGIN
    -- Only process open-format entries (no match pairing)
    IF NEW.match_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Pull formula params and session size from tournament
    SELECT games_per_session, hdcp_base, hdcp_percentage
    INTO   v_games_per_session, v_hdcp_base, v_hdcp_pct
    FROM   tournaments
    WHERE  id = NEW.tournament_id;

    -- Count games submitted by this player for this session so far (AFTER INSERT)
    SELECT COUNT(*)
    INTO   v_games_submitted
    FROM   scores
    WHERE  session_id  = NEW.session_id
      AND  player_id   = NEW.player_id
      AND  match_id IS NULL;

    -- Wait until all games for this session are recorded
    IF v_games_submitted < v_games_per_session THEN
        RETURN NEW;
    END IF;

    -- Aggregate raw pins across ALL open-format sessions for this player/tournament
    SELECT COUNT(DISTINCT session_id),
           SUM(score)
    INTO   v_sessions, v_raw_pins
    FROM   scores
    WHERE  tournament_id = NEW.tournament_id
      AND  player_id     = NEW.player_id
      AND  match_id IS NULL;

    v_new_average  := ROUND(v_raw_pins::DECIMAL / (v_sessions * v_games_per_session), 2);
    -- GREATEST(0, ...) so above-base bowlers get 0 instead of negative handicap
    v_new_handicap := GREATEST(0, FLOOR((v_hdcp_base - v_new_average) * v_hdcp_pct));

    INSERT INTO player_statistics (
        player_id, tournament_id, team_id,
        games_played, total_pins, current_average,
        matches_played, current_handicap, last_updated
    ) VALUES (
        NEW.player_id, NEW.tournament_id, NEW.team_id,
        v_sessions * v_games_per_session, v_raw_pins, v_new_average,
        v_sessions, v_new_handicap, CURRENT_TIMESTAMP
    )
    ON CONFLICT (player_id, tournament_id, team_id) DO UPDATE SET
        games_played     = v_sessions * v_games_per_session,
        total_pins       = v_raw_pins,
        current_average  = v_new_average,
        matches_played   = v_sessions,
        current_handicap = v_new_handicap,
        last_updated     = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_player_hdcp() IS
    'Fired AFTER INSERT on scores. Only processes open-format rows (match_id IS NULL). '
    'Waits until all games_per_session games for the session are present, then recomputes '
    'the player''s running raw average and new handicap, upserting player_statistics.';

DROP TRIGGER IF EXISTS trg_recalculate_hdcp ON scores;

CREATE TRIGGER trg_recalculate_hdcp
    AFTER INSERT ON scores
    FOR EACH ROW
    EXECUTE FUNCTION recalculate_player_hdcp();
