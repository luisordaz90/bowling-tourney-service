# Schema Changes: Unified Scores Table (Migration 013)

## What changed

Migration 013 consolidates three separate scoring tables into a single `scores` table and adds `games_per_session` to the `tournaments` table.

### Tables removed

| Table | What it stored | Why removed |
|---|---|---|
| `player_match_scores` | 3 game scores per player per match (paired format) | Replaced by `scores` |
| `session_entries` | 3 game scores per player per session (open format) | Replaced by `scores` |
| `team_match_scores` | Aggregated team totals per match | Derived on the fly from `scores`; no longer stored |

### Tables added

**`scores`** — one row per player per game per session

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `session_id` | UUID | FK → `league_sessions` |
| `tournament_id` | UUID | Denormalized for fast filtering |
| `player_id` | UUID | FK → `players` |
| `team_id` | UUID | FK → `teams` (nullable) |
| `match_id` | UUID | FK → `matches` — **NULL = open format**, NOT NULL = paired format |
| `game_number` | INTEGER | 1-based index within the session (1..`games_per_session`) |
| `score` | INTEGER | Raw pin count for this game (0–300) |
| `handicap_applied` | INTEGER | Per-game handicap snapshotted from `player_statistics.current_handicap` at submission time |
| `pins_with_hdcp` | INTEGER | Generated: `score + handicap_applied` |
| `recorded_at` | TIMESTAMP | Insertion timestamp |

Uniqueness is enforced with partial indexes:
- Open format: `(session_id, player_id, game_number) WHERE match_id IS NULL`
- Paired format: `(match_id, player_id, game_number) WHERE match_id IS NOT NULL`

### Columns added to `tournaments`

| Column | Default | Description |
|---|---|---|
| `games_per_session` | 3 | How many games are bowled per session. Controls how many `scores` rows are expected per player per session and is used in handicap calculation and point breakdowns. |

### Changes to `match_points`

The fixed per-game point columns (`home_game1_points`, `home_game2_points`, `home_game3_points`, and their away equivalents) were replaced with JSONB arrays:

| Old columns | New column | Example value |
|---|---|---|
| `home_game1_points`, `home_game2_points`, `home_game3_points` | `home_game_points JSONB` | `[1, 0, 1]` |
| `away_game1_points`, `away_game2_points`, `away_game3_points` | `away_game_points JSONB` | `[0, 1, 0]` |

`home_series_points`, `away_series_points`, `home_total_points`, and `away_total_points` remain. The `BETWEEN 0 AND 4` constraint on total points was relaxed to `>= 0` to support tournaments with more than 3 games.

---

## Why we did this

### The problem with three tables

The service had two parallel scoring systems with overlapping responsibility:

- `session_entries` — used when `schedule_type = 'open'`
- `player_match_scores` — used when `schedule_type = 'paired'`
- `team_match_scores` — a pre-aggregated copy of data already in `player_match_scores`

Both entry tables stored identical concepts (game scores for a player in a session) with nearly identical schemas. Every query, trigger, and view had to branch on format. Adding new features (e.g., configurable game counts) required changes in two places.

`team_match_scores` was effectively a materialized view that had to be manually refreshed via the `calculateTeamScoreInMatch` endpoint — a footgun waiting to go stale.

### Per-game rows

Previously, 3 games were stored as columns (`game1_score`, `game2_score`, `game3_score`). This hard-wired the assumption that every session has exactly 3 games.

With `scores`, each game is a separate row identified by `game_number`. The number of games per session is controlled by `tournaments.games_per_session` (default 3). Adding support for 2-game or 4-game sessions requires no schema change — only the `games_per_session` value on the tournament changes.

### Handicap snapshot

`handicap_applied` is stored per-game row so the historical record is immutable. The handicap in effect at submission time is preserved even if the player's average (and therefore future handicap) changes later. This is important for auditing and replaying standings.

---

## How scoring works going forward

### Open format (`schedule_type = 'open'`)

1. Client POSTs to `POST /tournaments/:id/scores` with `game1Score`, `game2Score`, `game3Score` (and optionally `gameNumber` + `score` for per-game submission in the future).
2. Server reads `player_statistics.current_handicap` for this player/tournament — this is the handicap the player *enters the session with*.
3. Server inserts `games_per_session` rows into `scores` with `match_id = NULL`, each carrying the same `handicap_applied`.
4. The `trg_recalculate_hdcp` trigger fires after each insert. It waits until the player has `games_per_session` rows for the session; then it recomputes the running raw average across all sessions and upserts `player_statistics.current_handicap`. This becomes the handicap the player carries into their *next* session.
5. Standings are computed by summing `pins_with_hdcp` per player across all sessions.

**Handicap formula:**
```
hdcp = GREATEST(0, FLOOR((hdcp_base - running_raw_average) * hdcp_percentage))
```
Parameters come from `tournaments.hdcp_base` and `tournaments.hdcp_percentage`. The GREATEST(0, ...) ensures above-base bowlers receive 0 rather than a negative handicap.

**Total pins for a session:**
```
total_pins = SUM(score) + handicap_applied * games_per_session
           = SUM(pins_with_hdcp)
```

### Paired format (`schedule_type = 'paired'`)

1. Client POSTs to `POST /tournaments/:id/scores` with the same payload, including `teamId`.
2. Server auto-resolves the match for that team in the given session.
3. Server inserts `games_per_session` rows into `scores` with `match_id` set.
4. Client then calls `POST /matches/:matchId/team-scores/calculate` once all players have submitted.
5. `calculateTeamScoreInMatch` aggregates per-team totals from `scores`, calls `calculate_match_points()`, writes to `match_points`, updates team/player statistics, and resolves the match winner.

### Point system

`calculate_match_points()` iterates `game_number` 1..`games_per_session`:
- 1 point to the team with the higher combined pin total for each game.
- 1 point to the team with the higher series total (sum of all games).
- Ties award 0 to both teams.
- Maximum points per match = `games_per_session + 1`.

Points are stored as a JSONB array in `match_points.home_game_points` / `away_game_points` so the breakdown scales with the configured game count.
