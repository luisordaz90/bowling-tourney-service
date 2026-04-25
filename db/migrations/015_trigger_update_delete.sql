-- Migration 015: Extend trg_recalculate_hdcp to fire on UPDATE and DELETE
--
-- Previously the trigger only fired AFTER INSERT. The JS helper
-- recalculateHandicapForPlayer() handled UPDATE/DELETE in application code.
-- This migration moves all handicap recalculation into the trigger so there
-- is a single source of truth.

CREATE OR REPLACE FUNCTION recalculate_player_hdcp()
RETURNS TRIGGER AS $$
DECLARE
    v_player_id         UUID;
    v_tournament_id     UUID;
    v_team_id           UUID;
    v_match_id          UUID;
    v_games_per_session INTEGER;
    v_games_submitted   INTEGER;
    v_hdcp_base         INTEGER;
    v_hdcp_pct          DECIMAL(4,2);
    v_sessions          INTEGER;
    v_raw_pins          INTEGER;
    v_new_average       DECIMAL(5,2);
    v_new_handicap      INTEGER;
    v_session_id        UUID;
BEGIN
    -- Use OLD for DELETE, NEW for INSERT/UPDATE
    IF TG_OP = 'DELETE' THEN
        v_player_id     := OLD.player_id;
        v_tournament_id := OLD.tournament_id;
        v_team_id       := OLD.team_id;
        v_match_id      := OLD.match_id;
        v_session_id    := OLD.session_id;
    ELSE
        v_player_id     := NEW.player_id;
        v_tournament_id := NEW.tournament_id;
        v_team_id       := NEW.team_id;
        v_match_id      := NEW.match_id;
        v_session_id    := NEW.session_id;
    END IF;

    -- Only process open-format entries (no match pairing)
    IF v_match_id IS NOT NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- Pull formula params and session size from tournament
    SELECT games_per_session, hdcp_base, hdcp_percentage
    INTO   v_games_per_session, v_hdcp_base, v_hdcp_pct
    FROM   tournaments
    WHERE  id = v_tournament_id;

    -- For INSERT/UPDATE: wait until all games for this session are recorded
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT COUNT(*)
        INTO   v_games_submitted
        FROM   scores
        WHERE  session_id  = v_session_id
          AND  player_id   = v_player_id
          AND  match_id IS NULL;

        IF v_games_submitted < v_games_per_session THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Aggregate raw pins across ALL open-format sessions for this player/tournament
    SELECT COUNT(DISTINCT session_id),
           COALESCE(SUM(score), 0)
    INTO   v_sessions, v_raw_pins
    FROM   scores
    WHERE  tournament_id = v_tournament_id
      AND  player_id     = v_player_id
      AND  match_id IS NULL;

    -- If no scores remain (all deleted), remove the statistics row
    IF v_sessions = 0 OR v_raw_pins = 0 THEN
        DELETE FROM player_statistics
        WHERE player_id = v_player_id AND tournament_id = v_tournament_id;
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    v_new_average  := ROUND(v_raw_pins::DECIMAL / (v_sessions * v_games_per_session), 2);
    v_new_handicap := GREATEST(0, FLOOR((v_hdcp_base - v_new_average) * v_hdcp_pct));

    INSERT INTO player_statistics (
        player_id, tournament_id, team_id,
        games_played, total_pins, current_average,
        matches_played, current_handicap, last_updated
    ) VALUES (
        v_player_id, v_tournament_id, v_team_id,
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

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_player_hdcp() IS
    'Fired AFTER INSERT, UPDATE, or DELETE on scores. Only processes open-format rows '
    '(match_id IS NULL). On INSERT/UPDATE, waits until all games_per_session games are '
    'present. On DELETE, immediately recomputes. Upserts player_statistics or deletes '
    'the row if no scores remain.';

DROP TRIGGER IF EXISTS trg_recalculate_hdcp ON scores;

CREATE TRIGGER trg_recalculate_hdcp
    AFTER INSERT OR UPDATE OR DELETE ON scores
    FOR EACH ROW
    EXECUTE FUNCTION recalculate_player_hdcp();
