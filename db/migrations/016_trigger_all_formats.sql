-- Migration 016: Extend player stats trigger to handle both open and paired formats
--
-- Previously the trigger only processed open-format scores (match_id IS NULL).
-- Paired-format scores were handled inline in scoresController.js, updating only
-- the global `players` table (lifetime stats) with no per-tournament breakdown.
--
-- This migration rewrites the trigger to populate `player_statistics` for ALL
-- score rows regardless of format. Handicap is calculated per-tournament for
-- both formats (paired uses it for match point calculation, open for pin totals).
-- The inline `UPDATE players` in scoresController paired branch is now redundant.

CREATE OR REPLACE FUNCTION recalculate_player_hdcp()
RETURNS TRIGGER AS $$
DECLARE
    v_player_id         UUID;
    v_tournament_id     UUID;
    v_team_id           UUID;
    v_session_id        UUID;
    v_schedule_type     TEXT;
    v_games_per_session INTEGER;
    v_hdcp_base         INTEGER;
    v_hdcp_pct          DECIMAL(4,2);
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
    SELECT schedule_type, games_per_session, hdcp_base, hdcp_percentage
    INTO   v_schedule_type, v_games_per_session, v_hdcp_base, v_hdcp_pct
    FROM   tournaments
    WHERE  id = v_tournament_id;

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

    -- Handicap: calculated per-tournament regardless of format
    v_new_handicap := GREATEST(0, FLOOR((v_hdcp_base - v_new_average) * v_hdcp_pct));

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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_player_hdcp() IS
    'Fired AFTER INSERT, UPDATE, or DELETE on scores. Processes both open and paired '
    'format rows. Waits until all games_per_session games are present before recalculating. '
    'Upserts player_statistics with games, pins, average, highest game/series, '
    'and handicap. Handicap is calculated per-tournament for both formats. '
    'Deletes the row if no scores remain.';

-- Trigger already exists from migration 015, but re-create to be safe
DROP TRIGGER IF EXISTS trg_recalculate_hdcp ON scores;

CREATE TRIGGER trg_recalculate_hdcp
    AFTER INSERT OR UPDATE OR DELETE ON scores
    FOR EACH ROW
    EXECUTE FUNCTION recalculate_player_hdcp();
