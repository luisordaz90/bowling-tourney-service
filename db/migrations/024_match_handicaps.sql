-- Migration 024: Add handicaps JSONB to matches
--
-- Stores the frozen handicap for every player in a match, keyed by player UUID.
-- Example: { "player-uuid-1": 18, "player-uuid-2": 6 }
--
-- On score re-submission, handicap_applied is read from this column
-- instead of player_statistics.current_handicap, preventing recalculation drift.


-- ─── 1. Add column ─────────────────────────────────────────────────────────────

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS handicaps JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN matches.handicaps IS
  'Frozen per-player handicaps for this match. Keyed by player UUID, value is the integer handicap. '
  'Populated on first score submission; used on re-submissions to preserve the original handicap.';


-- ─── 2. Backfill from existing scores ──────────────────────────────────────────

-- For each match, build { playerId: handicap } from the scores table.
-- Uses DISTINCT ON to pick one handicap_applied per player per match
-- (they should all be the same within a match).

UPDATE matches m
SET handicaps = sub.hdcp_map
FROM (
  SELECT
    s.match_id,
    jsonb_object_agg(s.player_id::text, s.handicap_applied) AS hdcp_map
  FROM (
    SELECT DISTINCT ON (match_id, player_id)
      match_id, player_id, handicap_applied
    FROM scores
    WHERE match_id IS NOT NULL
    ORDER BY match_id, player_id, game_number
  ) s
  GROUP BY s.match_id
) sub
WHERE m.id = sub.match_id;
