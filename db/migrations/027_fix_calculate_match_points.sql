-- Migration 027: Update calculate_match_points to read from scoring_config
--
-- Also adds tie support (0.5 points per tied game/series) using scoring_config.points.

DROP FUNCTION IF EXISTS calculate_match_points(UUID);

CREATE OR REPLACE FUNCTION calculate_match_points(p_match_id UUID)
RETURNS TABLE(
    home_team_id UUID,
    away_team_id UUID,
    home_game_pts JSONB,
    home_series_pts NUMERIC(3,1),
    home_total_pts NUMERIC(3,1),
    away_game_pts JSONB,
    away_series_pts NUMERIC(3,1),
    away_total_pts NUMERIC(3,1)
)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_home_team_id      UUID;
    v_away_team_id      UUID;
    v_tournament_id     UUID;
    v_scoring_config    JSONB;
    v_games_per_session INTEGER;
    v_pts_game_win      NUMERIC(3,1);
    v_pts_game_tie      NUMERIC(3,1);
    v_pts_series_win    NUMERIC(3,1);
    v_pts_series_tie    NUMERIC(3,1);
    v_home_game_pts     JSONB    := '[]'::JSONB;
    v_away_game_pts     JSONB    := '[]'::JSONB;
    v_home_series       INTEGER  := 0;
    v_away_series       INTEGER  := 0;
    v_home_game_total   NUMERIC(5,1) := 0;
    v_away_game_total   NUMERIC(5,1) := 0;
    v_home_g            INTEGER;
    v_away_g            INTEGER;
    v_home_pt           NUMERIC(3,1);
    v_away_pt           NUMERIC(3,1);
    v_home_series_pt    NUMERIC(3,1);
    v_away_series_pt    NUMERIC(3,1);
    v_game              INTEGER;
BEGIN
    SELECT m.home_team_id, m.away_team_id, m.tournament_id
    INTO   v_home_team_id, v_away_team_id, v_tournament_id
    FROM   matches m
    WHERE  m.id = p_match_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Match % not found', p_match_id;
    END IF;

    SELECT t.scoring_config
    INTO   v_scoring_config
    FROM   tournaments t
    WHERE  t.id = v_tournament_id;

    -- Read config with defaults
    v_games_per_session := COALESCE((v_scoring_config->>'games_per_session')::int, 3);
    v_pts_game_win   := COALESCE((v_scoring_config->'points'->>'per_game_win')::numeric, 1);
    v_pts_game_tie   := COALESCE((v_scoring_config->'points'->>'per_game_tie')::numeric, 0.5);
    v_pts_series_win := COALESCE((v_scoring_config->'points'->>'per_series_win')::numeric, 1);
    v_pts_series_tie := COALESCE((v_scoring_config->'points'->>'per_series_tie')::numeric, 0.5);

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

        IF v_home_g > v_away_g THEN
            v_home_pt := v_pts_game_win;
            v_away_pt := 0;
        ELSIF v_away_g > v_home_g THEN
            v_home_pt := 0;
            v_away_pt := v_pts_game_win;
        ELSE
            v_home_pt := v_pts_game_tie;
            v_away_pt := v_pts_game_tie;
        END IF;

        v_home_game_pts   := v_home_game_pts   || to_jsonb(v_home_pt);
        v_away_game_pts   := v_away_game_pts   || to_jsonb(v_away_pt);
        v_home_game_total := v_home_game_total + v_home_pt;
        v_away_game_total := v_away_game_total + v_away_pt;
    END LOOP;

    IF v_home_series > v_away_series THEN
        v_home_series_pt := v_pts_series_win;
        v_away_series_pt := 0;
    ELSIF v_away_series > v_home_series THEN
        v_home_series_pt := 0;
        v_away_series_pt := v_pts_series_win;
    ELSE
        v_home_series_pt := v_pts_series_tie;
        v_away_series_pt := v_pts_series_tie;
    END IF;

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
$function$;

COMMENT ON FUNCTION calculate_match_points(UUID) IS
  'Calculates match point breakdown from scores. Reads games_per_session and point '
  'values (win/tie for games and series) from tournaments.scoring_config JSONB.';
