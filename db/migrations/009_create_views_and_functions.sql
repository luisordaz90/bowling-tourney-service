-- Migration 009: Create views and database functions
-- These objects are required by the application but were never versioned.
-- Depends on: all previous migrations (001–008)

-- ============================================================
-- VIEW: tournament_standings
-- Live standings for a tournament ordered by points earned.
-- Used by: getStandings, getTournamentTeamsStatistics,
--          getTeamTournamentStatistics
-- ============================================================
CREATE OR REPLACE VIEW tournament_standings AS
SELECT
    ts.team_id,
    t.name                          AS team_name,
    t.captain_name,
    ts.tournament_id,
    ts.total_matches_played         AS matches_played,
    ts.matches_won,
    ts.matches_lost,
    ts.total_team_score             AS total_score,
    ts.team_average,
    ts.total_points,
    ts.points_percentage,
    CASE
        WHEN ts.total_matches_played > 0
        THEN ROUND((ts.matches_won::DECIMAL / ts.total_matches_played) * 100, 2)
        ELSE 0
    END                             AS win_percentage,
    tt.seed_number,
    tt.status,
    RANK() OVER (
        PARTITION BY ts.tournament_id
        ORDER BY ts.total_points DESC, ts.total_team_score DESC
    )                               AS current_rank
FROM      team_statistics  ts
JOIN      teams             t  ON ts.team_id      = t.id
JOIN      tournament_teams  tt ON ts.team_id      = tt.team_id
                               AND ts.tournament_id = tt.tournament_id;

COMMENT ON VIEW tournament_standings IS
    'Live per-tournament team standings ranked by total match points then total score';


-- ============================================================
-- VIEW: player_performance
-- Aggregates per-match scores into per-player per-tournament
-- performance metrics derived directly from player_match_scores.
-- Used by: getTournamentPlayersStatistics
-- ============================================================
CREATE OR REPLACE VIEW player_performance AS
SELECT
    p.id                                                                                    AS player_id,
    p.name                                                                                  AS player_name,
    pms.team_id,
    m.tournament_id,
    COUNT(DISTINCT pms.id)                                                                  AS matches_played,
    COUNT(DISTINCT pms.id) * 3                                                              AS games_played,
    COALESCE(SUM(pms.game1_score + pms.game2_score + pms.game3_score), 0)                  AS total_pins,
    CASE
        WHEN COUNT(pms.id) > 0
        THEN ROUND(
                 SUM(pms.game1_score + pms.game2_score + pms.game3_score)::DECIMAL
                 / (COUNT(pms.id) * 3),
             2)
        ELSE 0
    END                                                                                     AS current_average,
    COALESCE(MAX(GREATEST(pms.game1_score, pms.game2_score, pms.game3_score)), 0)          AS highest_game,
    COALESCE(MAX(pms.game1_score + pms.game2_score + pms.game3_score), 0)                  AS highest_series,
    t.name                                                                                  AS team_name,
    tour.name                                                                               AS tournament_name
FROM      players             p
JOIN      player_match_scores pms  ON p.id              = pms.player_id
JOIN      matches             m    ON pms.match_id       = m.id
JOIN      teams               t    ON pms.team_id        = t.id
JOIN      tournaments         tour ON m.tournament_id    = tour.id
GROUP BY
    p.id, p.name,
    pms.team_id,
    m.tournament_id,
    t.name,
    tour.name;

COMMENT ON VIEW player_performance IS
    'Live per-player per-tournament performance derived from player_match_scores; always current';


-- ============================================================
-- FUNCTION: calculate_match_points(match_id)
-- Computes the 4-point breakdown for a completed match.
-- Point rules:
--   • 1 point awarded to the team with the higher combined pin
--     total for each individual game (games 1, 2, 3).
--   • 1 point awarded to the team with the higher series total
--     (sum of all three games).
--   • Ties on any individual game or the series award 0 points
--     to both teams for that opportunity.
-- Called automatically by calculateTeamScoreInMatch once both
-- team scores have been submitted.
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_match_points(p_match_id UUID)
RETURNS TABLE (
    home_team_id    UUID,
    away_team_id    UUID,
    home_g1_pts     INTEGER,
    home_g2_pts     INTEGER,
    home_g3_pts     INTEGER,
    home_series_pts INTEGER,
    home_total_pts  INTEGER,
    away_g1_pts     INTEGER,
    away_g2_pts     INTEGER,
    away_g3_pts     INTEGER,
    away_series_pts INTEGER,
    away_total_pts  INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_home_team_id  UUID;
    v_away_team_id  UUID;
    v_home_g1       INTEGER;
    v_home_g2       INTEGER;
    v_home_g3       INTEGER;
    v_away_g1       INTEGER;
    v_away_g2       INTEGER;
    v_away_g3       INTEGER;
    v_home_series   INTEGER;
    v_away_series   INTEGER;
BEGIN
    -- Resolve which team is home and which is away
    SELECT m.home_team_id, m.away_team_id
    INTO   v_home_team_id, v_away_team_id
    FROM   matches m
    WHERE  m.id = p_match_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Match % not found', p_match_id;
    END IF;

    -- Sum per-game pin totals for the home team across all players
    SELECT
        COALESCE(SUM(pms.game1_score), 0),
        COALESCE(SUM(pms.game2_score), 0),
        COALESCE(SUM(pms.game3_score), 0)
    INTO v_home_g1, v_home_g2, v_home_g3
    FROM player_match_scores pms
    WHERE pms.match_id = p_match_id
      AND pms.team_id  = v_home_team_id;

    -- Sum per-game pin totals for the away team across all players
    SELECT
        COALESCE(SUM(pms.game1_score), 0),
        COALESCE(SUM(pms.game2_score), 0),
        COALESCE(SUM(pms.game3_score), 0)
    INTO v_away_g1, v_away_g2, v_away_g3
    FROM player_match_scores pms
    WHERE pms.match_id = p_match_id
      AND pms.team_id  = v_away_team_id;

    v_home_series := v_home_g1 + v_home_g2 + v_home_g3;
    v_away_series := v_away_g1 + v_away_g2 + v_away_g3;

    RETURN QUERY SELECT
        v_home_team_id,
        v_away_team_id,
        -- Game 1 point
        CASE WHEN v_home_g1 > v_away_g1 THEN 1 ELSE 0 END,
        -- Game 2 point
        CASE WHEN v_home_g2 > v_away_g2 THEN 1 ELSE 0 END,
        -- Game 3 point
        CASE WHEN v_home_g3 > v_away_g3 THEN 1 ELSE 0 END,
        -- Series point
        CASE WHEN v_home_series > v_away_series THEN 1 ELSE 0 END,
        -- Home total
        (CASE WHEN v_home_g1 > v_away_g1     THEN 1 ELSE 0 END
       + CASE WHEN v_home_g2 > v_away_g2     THEN 1 ELSE 0 END
       + CASE WHEN v_home_g3 > v_away_g3     THEN 1 ELSE 0 END
       + CASE WHEN v_home_series > v_away_series THEN 1 ELSE 0 END),
        -- Away game points
        CASE WHEN v_away_g1 > v_home_g1 THEN 1 ELSE 0 END,
        CASE WHEN v_away_g2 > v_home_g2 THEN 1 ELSE 0 END,
        CASE WHEN v_away_g3 > v_home_g3 THEN 1 ELSE 0 END,
        CASE WHEN v_away_series > v_home_series THEN 1 ELSE 0 END,
        -- Away total
        (CASE WHEN v_away_g1 > v_home_g1     THEN 1 ELSE 0 END
       + CASE WHEN v_away_g2 > v_home_g2     THEN 1 ELSE 0 END
       + CASE WHEN v_away_g3 > v_home_g3     THEN 1 ELSE 0 END
       + CASE WHEN v_away_series > v_home_series THEN 1 ELSE 0 END);
END;
$$;

COMMENT ON FUNCTION calculate_match_points(UUID) IS
    'Returns the 4-point breakdown for a match. 1 pt per game won + 1 series pt. Ties award 0 to both sides.';
