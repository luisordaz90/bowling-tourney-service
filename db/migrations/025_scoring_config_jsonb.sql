-- Migration 025: Add scoring_config JSONB to tournaments
--
-- Consolidates handicap formula + point system + bonus categories into a
-- single JSONB column. Replaces hdcp_base / hdcp_percentage typed columns.
--
-- Schema:
-- {
--   "handicap": {
--     "base_score": 210,
--     "percentage": 90,
--     "floor": 0,
--     "cap": null
--   },
--   "points": {
--     "per_game_win": 1,
--     "per_game_tie": 0.5,
--     "per_series_win": 1,
--     "per_series_tie": 0.5,
--     "bonus_categories": [],
--     "per_bonus": 1
--   }
-- }


-- ─── 1. Add scoring_config column ──────────────────────────────────────────────

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS scoring_config JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN tournaments.scoring_config IS
  'Per-tournament scoring rules: handicap formula (base_score, percentage, floor, cap) '
  'and point system (per_game_win/tie, per_series_win/tie, bonus_categories, per_bonus).';


-- ─── 2. Backfill from existing typed columns ───────────────────────────────────

UPDATE tournaments
SET scoring_config = jsonb_build_object(
  'handicap', jsonb_build_object(
    'base_score', hdcp_base,
    'percentage', (hdcp_percentage * 100)::int,
    'floor', 0,
    'cap', null
  ),
  'points', jsonb_build_object(
    'per_game_win', 1,
    'per_game_tie', 0.5,
    'per_series_win', 1,
    'per_series_tie', 0.5,
    'bonus_categories', '[]'::jsonb,
    'per_bonus', 1
  )
);


-- ─── 3. Fix Patorneo: base_score should be 210, not 220 ────────────────────────

UPDATE tournaments
SET scoring_config = jsonb_set(scoring_config, '{handicap,base_score}', '210')
WHERE name = '28 Edicion';


-- ─── 4. Update trigger to read from scoring_config ─────────────────────────────

CREATE OR REPLACE FUNCTION recalculate_player_hdcp()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_player_id         UUID;
    v_tournament_id     UUID;
    v_team_id           UUID;
    v_session_id        UUID;
    v_schedule_type     TEXT;
    v_games_per_session INTEGER;
    v_scoring_config    JSONB;
    v_hdcp_base         INTEGER;
    v_hdcp_pct          DECIMAL(4,2);
    v_hdcp_floor        INTEGER;
    v_hdcp_cap          INTEGER;
    v_games_submitted   INTEGER;
    v_total_games       INTEGER;
    v_total_pins        INTEGER;
    v_sessions          INTEGER;
    v_new_average       DECIMAL(5,2);
    v_new_handicap      INTEGER;
    v_highest_game      INTEGER;
    v_highest_series    INTEGER;
    v_is_open           BOOLEAN;
BEGIN
    -- Use OLD for DELETE, NEW for INSERT/UPDATE
    IF TG_OP = 'DELETE' THEN
        v_player_id     := OLD.player_id;
        v_tournament_id := OLD.tournament_id;
        v_team_id       := OLD.team_id;
        v_session_id    := OLD.session_id;
    ELSE
        v_player_id     := NEW.player_id;
        v_tournament_id := NEW.tournament_id;
        v_team_id       := NEW.team_id;
        v_session_id    := NEW.session_id;
    END IF;

    -- Pull tournament config
    SELECT schedule_type, games_per_session, scoring_config
    INTO   v_schedule_type, v_games_per_session, v_scoring_config
    FROM   tournaments
    WHERE  id = v_tournament_id;

    -- Read handicap settings from scoring_config (fall back to defaults)
    v_hdcp_base  := COALESCE((v_scoring_config->'handicap'->>'base_score')::int, 220);
    v_hdcp_pct   := COALESCE((v_scoring_config->'handicap'->>'percentage')::decimal / 100.0, 0.90);
    v_hdcp_floor := COALESCE((v_scoring_config->'handicap'->>'floor')::int, 0);
    v_hdcp_cap   := (v_scoring_config->'handicap'->>'cap')::int;  -- NULL if not set

    v_is_open := (v_schedule_type = 'open');

    -- For INSERT/UPDATE: wait until all games for this session are recorded
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF v_is_open THEN
            SELECT COUNT(*)
            INTO   v_games_submitted
            FROM   scores
            WHERE  session_id = v_session_id
              AND  player_id  = v_player_id
              AND  match_id IS NULL;
        ELSE
            SELECT COUNT(*)
            INTO   v_games_submitted
            FROM   scores
            WHERE  session_id = v_session_id
              AND  player_id  = v_player_id
              AND  match_id IS NOT NULL;
        END IF;

        IF v_games_submitted < v_games_per_session THEN
            IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
        END IF;
    END IF;

    -- Aggregate all scores for this player in this tournament
    IF v_is_open THEN
        SELECT COUNT(DISTINCT session_id),
               COALESCE(SUM(score), 0),
               COUNT(*)
        INTO   v_sessions, v_total_pins, v_total_games
        FROM   scores
        WHERE  tournament_id = v_tournament_id
          AND  player_id     = v_player_id
          AND  match_id IS NULL;
    ELSE
        SELECT COUNT(DISTINCT session_id),
               COALESCE(SUM(score), 0),
               COUNT(*)
        INTO   v_sessions, v_total_pins, v_total_games
        FROM   scores
        WHERE  tournament_id = v_tournament_id
          AND  player_id     = v_player_id
          AND  match_id IS NOT NULL;
    END IF;

    -- If no scores remain, remove the statistics row
    IF v_total_games = 0 THEN
        DELETE FROM player_statistics
        WHERE player_id = v_player_id AND tournament_id = v_tournament_id;
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- Calculate average
    v_new_average := ROUND(v_total_pins::DECIMAL / v_total_games, 2);

    -- Handicap formula: FLOOR((base - average) * percentage), clamped to [floor, cap]
    v_new_handicap := GREATEST(v_hdcp_floor, FLOOR((v_hdcp_base - v_new_average) * v_hdcp_pct));
    IF v_hdcp_cap IS NOT NULL THEN
        v_new_handicap := LEAST(v_new_handicap, v_hdcp_cap);
    END IF;

    -- Highest single game
    IF v_is_open THEN
        SELECT COALESCE(MAX(score), 0)
        INTO   v_highest_game
        FROM   scores
        WHERE  tournament_id = v_tournament_id
          AND  player_id     = v_player_id
          AND  match_id IS NULL;
    ELSE
        SELECT COALESCE(MAX(score), 0)
        INTO   v_highest_game
        FROM   scores
        WHERE  tournament_id = v_tournament_id
          AND  player_id     = v_player_id
          AND  match_id IS NOT NULL;
    END IF;

    -- Highest series (sum of scores in a single session)
    IF v_is_open THEN
        SELECT COALESCE(MAX(session_total), 0)
        INTO   v_highest_series
        FROM (
            SELECT session_id, SUM(score) AS session_total
            FROM   scores
            WHERE  tournament_id = v_tournament_id
              AND  player_id     = v_player_id
              AND  match_id IS NULL
            GROUP BY session_id
        ) sub;
    ELSE
        SELECT COALESCE(MAX(session_total), 0)
        INTO   v_highest_series
        FROM (
            SELECT session_id, SUM(score) AS session_total
            FROM   scores
            WHERE  tournament_id = v_tournament_id
              AND  player_id     = v_player_id
              AND  match_id IS NOT NULL
            GROUP BY session_id
        ) sub;
    END IF;

    -- Upsert player_statistics
    INSERT INTO player_statistics (
        player_id, tournament_id, team_id,
        games_played, total_pins, current_average,
        highest_game, highest_series,
        matches_played, current_handicap, last_updated
    ) VALUES (
        v_player_id, v_tournament_id, v_team_id,
        v_total_games, v_total_pins, v_new_average,
        v_highest_game, v_highest_series,
        v_sessions, v_new_handicap, CURRENT_TIMESTAMP
    )
    ON CONFLICT (player_id, tournament_id, team_id) DO UPDATE SET
        games_played     = v_total_games,
        total_pins       = v_total_pins,
        current_average  = v_new_average,
        highest_game     = v_highest_game,
        highest_series   = v_highest_series,
        matches_played   = v_sessions,
        current_handicap = v_new_handicap,
        last_updated     = CURRENT_TIMESTAMP;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

COMMENT ON FUNCTION recalculate_player_hdcp() IS
  'Fired AFTER INSERT, UPDATE, or DELETE on scores. Reads handicap formula from '
  'tournaments.scoring_config JSONB. Waits until all games_per_session games are '
  'present before recalculating. Upserts player_statistics with games, pins, average, '
  'highest game/series, and handicap. Supports floor and cap. Deletes the row if no scores remain.';


-- ─── 5. Drop old typed columns ─────────────────────────────────────────────────

ALTER TABLE tournaments DROP COLUMN IF EXISTS hdcp_base;
ALTER TABLE tournaments DROP COLUMN IF EXISTS hdcp_percentage;
