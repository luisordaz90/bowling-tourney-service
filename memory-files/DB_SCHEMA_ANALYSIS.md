# DB Schema Analysis — bowling-tourney-service

This document reconstructs and analyzes the full database schema as inferred from the
migration file and all controller SQL queries. The base schema (players, teams, tournaments,
matches, scores) was **never versioned in a migration** — only `001_add_leagues_and_editions.sql`
exists. Everything below is reconstructed from the live queries.

---

## Table of Contents

1. [Entity Overview](#1-entity-overview)
2. [Table Definitions](#2-table-definitions)
3. [Match Making — How It Works](#3-match-making--how-it-works)
4. [Score Tracking — How It Works](#4-score-tracking--how-it-works)
5. [The Points System](#5-the-points-system)
6. [Views and DB Functions](#6-views-and-db-functions)
7. [ERD (Text Representation)](#7-erd-text-representation)
8. [Issues & Gaps](#8-issues--gaps)

---

## 1. Entity Overview

| Table | Purpose |
|---|---|
| `leagues` | Top-level grouping of tournaments (standard, youth, senior) |
| `tournament_editions` | A season/edition within a league |
| `tournaments` | A single tournament event (can belong to a league + edition) |
| `teams` | Team entities independent of any tournament |
| `players` | Player entities independent of any team |
| `tournament_teams` | Registers a team into a specific tournament |
| `team_players` | Registers a player into a team for a specific tournament |
| `league_sessions` | A scheduled session/week within a tournament |
| `matches` | A single matchup between two teams in a tournament session |
| `player_match_scores` | Individual player's 3-game score within a match |
| `team_match_scores` | Aggregated team score for a match, derived from player scores |
| `match_points` | Point totals per team per match (game-by-game and series) |
| `team_statistics` | Rolled-up team performance per tournament |
| `player_statistics` | Rolled-up player performance per tournament |
| `player_league_eligibility` | Eligibility status of a player within a league |
| `team_league_violations` | Rule violations logged against a team in a league |

---

## 2. Table Definitions

### `leagues`
```sql
CREATE TABLE leagues (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    VARCHAR(255) NOT NULL UNIQUE,
    description             TEXT,
    league_type             VARCHAR(50) DEFAULT 'standard',  -- standard | youth | senior
    status                  VARCHAR(20)  DEFAULT 'active',   -- active | inactive | archived
    max_teams_per_tournament INTEGER,                        -- NULL = no limit
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `tournament_editions`
```sql
CREATE TABLE tournament_editions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id           UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    edition_number      INTEGER NOT NULL,
    name                VARCHAR(255) NOT NULL,
    season              VARCHAR(50),   -- spring | summer | fall | winter
    year                INTEGER NOT NULL,
    start_date          TIMESTAMP NOT NULL,
    end_date            TIMESTAMP NOT NULL,
    max_teams           INTEGER,
    total_sessions      INTEGER DEFAULT 1,
    session_type        VARCHAR(50) DEFAULT 'weekly',
    sessions_completed  INTEGER DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'draft', -- draft | active | completed | cancelled
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (league_id, edition_number),
    UNIQUE (league_id, name)
);
```

### `tournaments`
> Base columns exist before the migration. `league_id` and `edition_id` were added by
> `001_add_leagues_and_editions.sql`.

```sql
CREATE TABLE tournaments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    start_date          TIMESTAMP NOT NULL,
    end_date            TIMESTAMP NOT NULL,
    max_teams           INTEGER NOT NULL,
    total_sessions      INTEGER NOT NULL,
    session_type        VARCHAR(50) NOT NULL,   -- e.g. 'weekly'
    sessions_completed  INTEGER DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'draft', -- draft | active | completed | cancelled
    league_id           UUID REFERENCES leagues(id) ON DELETE SET NULL,    -- added by migration
    edition_id          UUID REFERENCES tournament_editions(id) ON DELETE SET NULL, -- added by migration
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `teams`
```sql
CREATE TABLE teams (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL UNIQUE,
    captain_name    VARCHAR(255),
    captain_email   VARCHAR(255),
    captain_phone   VARCHAR(50),
    status          VARCHAR(20) DEFAULT 'active',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `players`
```sql
CREATE TABLE players (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    email               VARCHAR(255),
    phone               VARCHAR(50),
    handicap            INTEGER DEFAULT 0,
    average_score       DECIMAL(5,2) DEFAULT 0,
    total_games_played  INTEGER DEFAULT 0,
    total_pins          INTEGER DEFAULT 0,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `tournament_teams`
The join table that places a team into a tournament. This is the **source of truth for
which teams compete in a given tournament** and is the basis for match generation.

```sql
CREATE TABLE tournament_teams (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id               UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id                     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    seed_number                 INTEGER,           -- used to order teams for scheduling
    status                      VARCHAR(20) DEFAULT 'registered', -- registered | withdrawn
    total_tournament_score      INTEGER DEFAULT 0,
    games_played_in_tournament  INTEGER DEFAULT 0,
    sessions_played_in_tournament INTEGER DEFAULT 0,
    registration_date           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tournament_id, team_id)
);
```

### `team_players`
Scoped to a tournament — a player's membership in a team is tracked **per tournament**,
not globally. This is what allows the league-level "no double teaming" rule to be enforced.

```sql
CREATE TABLE team_players (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    role            VARCHAR(20) DEFAULT 'regular', -- captain | regular | substitute
    is_active       BOOLEAN DEFAULT true,
    joined_date     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    left_date       TIMESTAMP
);
```

> **Trigger**: `validate_player_team_assignment_trigger` fires on INSERT/UPDATE of `team_players`.
> It checks that the same player is not on two different teams within the same league's active tournaments.

### `league_sessions`
Represents a week/round of play within a tournament. Matches are assigned to sessions.

```sql
CREATE TABLE league_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    session_number  INTEGER NOT NULL,
    session_name    VARCHAR(255),
    session_date    TIMESTAMP NOT NULL,
    status          VARCHAR(20) DEFAULT 'scheduled', -- scheduled | active | completed | cancelled
    notes           TEXT,
    UNIQUE (tournament_id, session_number)
);
```

### `matches`
The central match record. Links two registered teams within a tournament session.

```sql
CREATE TABLE matches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    home_team_id    UUID NOT NULL REFERENCES teams(id),
    away_team_id    UUID NOT NULL REFERENCES teams(id),
    winner_team_id  UUID REFERENCES teams(id),        -- NULL until match is completed
    session_id      UUID REFERENCES league_sessions(id),
    session_number  INTEGER,                           -- denormalized copy of session number
    match_date      TIMESTAMP,
    match_name      VARCHAR(255),
    status          VARCHAR(20) DEFAULT 'scheduled',  -- scheduled | in_progress | completed | cancelled | postponed
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

> **Note**: `session_id` is a FK to `league_sessions`, but `session_number` is also stored
> directly on the match as a denormalized integer. Both coexist.

### `player_match_scores`
Per-player, per-match score record. Stores all three individual game scores.

```sql
CREATE TABLE player_match_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id         UUID NOT NULL REFERENCES teams(id),
    player_id       UUID NOT NULL REFERENCES players(id),
    game1_score     INTEGER NOT NULL,   -- 0–300
    game2_score     INTEGER NOT NULL,   -- 0–300
    game3_score     INTEGER NOT NULL,   -- 0–300
    handicap_applied INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (match_id, player_id)        -- one entry per player per match
);
```

### `team_match_scores`
Aggregated team-level score for a match. Calculated by summing all `player_match_scores`
for that team. Created/updated explicitly via the `calculateTeamScoreInMatch` endpoint.

```sql
CREATE TABLE team_match_scores (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id            UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id             UUID NOT NULL REFERENCES teams(id),
    total_team_score    INTEGER NOT NULL,
    total_handicap      INTEGER DEFAULT 0,
    team_average        DECIMAL(5,2),
    games_played        INTEGER,
    recorded_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (match_id, team_id)
);
```

### `match_points`
Stores the **point breakdown** per match after both teams have scores. Calculated by the
`calculate_match_points()` database function. One row per match.

```sql
CREATE TABLE match_points (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id            UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE UNIQUE,
    home_team_id        UUID NOT NULL REFERENCES teams(id),
    away_team_id        UUID NOT NULL REFERENCES teams(id),
    -- Per-game points (1 point to winner of each game)
    home_game1_points   INTEGER DEFAULT 0,
    home_game2_points   INTEGER DEFAULT 0,
    home_game3_points   INTEGER DEFAULT 0,
    home_series_points  INTEGER DEFAULT 0,  -- 1 point for winning the series total
    home_total_points   INTEGER DEFAULT 0,  -- sum of game + series points (max 4)
    away_game1_points   INTEGER DEFAULT 0,
    away_game2_points   INTEGER DEFAULT 0,
    away_game3_points   INTEGER DEFAULT 0,
    away_series_points  INTEGER DEFAULT 0,
    away_total_points   INTEGER DEFAULT 0,
    calculated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `team_statistics`
Rolled-up performance per team per tournament. Updated automatically during
`calculateTeamScoreInMatch` when a match is completed.

```sql
CREATE TABLE team_statistics (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id                 UUID NOT NULL REFERENCES teams(id),
    tournament_id           UUID NOT NULL REFERENCES tournaments(id),
    total_matches_played    INTEGER DEFAULT 0,
    matches_won             INTEGER DEFAULT 0,
    matches_lost            INTEGER DEFAULT 0,
    total_team_score        INTEGER DEFAULT 0,
    team_average            DECIMAL(6,2) DEFAULT 0,
    total_points            INTEGER DEFAULT 0,        -- cumulative match_points earned
    points_percentage       DECIMAL(5,2) DEFAULT 0,  -- total_points / (matches * 4) * 100
    rank_position           INTEGER,
    last_updated            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (team_id, tournament_id)
);
```

### `player_statistics`
Rolled-up player performance per tournament (and team). Updated manually via the
`PUT /api/player-statistics/:id/:tournamentId` endpoint — **not auto-updated on score entry**.

```sql
CREATE TABLE player_statistics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id       UUID NOT NULL REFERENCES players(id),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id),
    team_id         UUID REFERENCES teams(id),
    games_played    INTEGER DEFAULT 0,
    total_pins      INTEGER DEFAULT 0,
    current_average DECIMAL(5,2) DEFAULT 0,
    highest_game    INTEGER DEFAULT 0,
    highest_series  INTEGER DEFAULT 0,
    matches_played  INTEGER DEFAULT 0,
    last_updated    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (player_id, tournament_id, team_id)
);
```

### `player_league_eligibility`
```sql
CREATE TABLE player_league_eligibility (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    status          VARCHAR(20) DEFAULT 'eligible', -- eligible | suspended | banned
    reason          TEXT,
    effective_date  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expiry_date     TIMESTAMP,   -- NULL = permanent
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (player_id, league_id)
);
```

### `team_league_violations`
```sql
CREATE TABLE team_league_violations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    edition_id      UUID REFERENCES tournament_editions(id) ON DELETE CASCADE,
    player_id       UUID REFERENCES players(id) ON DELETE CASCADE,
    violation_type  VARCHAR(50) NOT NULL,  -- e.g. 'multiple_teams', 'ineligible_player'
    description     TEXT NOT NULL,
    detected_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at     TIMESTAMP,
    status          VARCHAR(20) DEFAULT 'open' -- open | resolved | dismissed
);
```

---

## 3. Match Making — How It Works

Match making follows a three-step process: register teams, generate a round-robin schedule,
then persist the schedule as rows in `matches` and `league_sessions`.

### Step 1 — Team Registration

Teams are placed into a tournament via `tournament_teams`. A `seed_number` can optionally be
assigned and is used to order teams during schedule generation.

```
tournaments ──< tournament_teams >── teams
                  └─ seed_number (ordering hint for schedule)
```

### Step 2 — Schedule Generation (JavaScript)

The round-robin algorithm runs in-process in `utils/helpers.js` via
`generateRoundRobinSchedule(teams)`. It uses the **circle algorithm**:

- With **N even** teams: N-1 sessions, each with N/2 matches. One team is fixed as an
  anchor; the rest rotate around it each session.
- With **N odd** teams: N sessions, each with (N-1)/2 matches. A BYE slot rotates each
  session; the team that draws the BYE sits out.

The function returns a schedule object — a list of sessions, each with a list of
`{ homeTeam, awayTeam }` pairs. This is pure in-memory computation; nothing is written to
the DB until Step 3.

### Step 3 — Persisting the Schedule

`POST /:tournamentId/schedule/round-robin` triggers `generateMatches()`, which:

1. Calls `generateRoundRobinSchedule` for the teams in `tournament_teams`.
2. For each session in the output, creates a row in `league_sessions` (if one for that
   session number doesn't already exist).
3. For each match pair in the session, inserts a row into `matches` referencing:
   - `tournament_id`
   - `home_team_id` / `away_team_id`
   - `session_id` (FK to the `league_sessions` row just created)
   - `session_number` (also stored directly on the match — denormalized)

### Match Chain

```
leagues
  └──< tournament_editions
         └──< tournaments (league_id, edition_id optional)
                └──< tournament_teams (which teams compete)
                └──< league_sessions (session 1, 2, 3…)
                       └──< matches (home_team_id, away_team_id, session_id)
```

A match **does not directly reference a league or edition**. The path is always:
`match → tournament → league / edition`.

---

## 4. Score Tracking — How It Works

There are **two separate, disconnected score systems** in the codebase:

### System A — Match-Based Scoring (PostgreSQL, active)

This is the primary, correct system. Scores are tied directly to matches.

```
matches
  └──< player_match_scores  (per player: game1, game2, game3)
  └──< team_match_scores    (aggregated per team, computed from player scores)
  └──  match_points         (point breakdown: game pts + series pt, one row per match)

team_statistics             (rolled up per team per tournament)
player_statistics           (rolled up per player per tournament)
players                     (total_games_played, total_pins, average_score updated inline)
```

**Flow for recording a completed match:**

```
1. POST /matches/:matchId/player-scores
   → INSERT player_match_scores (game1, game2, game3, handicap)
   → UPDATE players SET total_games_played, total_pins, average_score

2. POST /matches/:matchId/team-scores/calculate   (for each team)
   → SUM player_match_scores → INSERT/UPDATE team_match_scores
   → If both teams now have a team_match_score:
       → CALL calculate_match_points(matchId)          ← DB function
       → INSERT/UPDATE match_points
       → UPDATE matches SET winner_team_id, status = 'completed'
       → UPSERT team_statistics (wins, losses, total_points, points_percentage)
```

### System B — League Day Scoring (in-memory, legacy)

`scoreController.js` runs an entirely separate score recording flow using in-memory arrays
from `models/index.js`. This system:

- Is **not persisted** to PostgreSQL.
- Is **not linked to matches** — scores are attached to `leagueDay` objects in memory.
- Updates `players[].totalPins` and `teams[].totalScore` in the in-memory store only.
- Will be lost on any server restart.

**This system is a dead end.** It was likely the original prototype before the match-based
system was built. It should be migrated to PostgreSQL or removed.

---

## 5. The Points System

Each completed match awards a maximum of **4 points**, split as follows:

| Opportunity | Points |
|---|---|
| Win Game 1 (higher combined team pin total) | 1 |
| Win Game 2 | 1 |
| Win Game 3 | 1 |
| Win the Series (highest cumulative pin total across all 3 games) | 1 |
| **Total per match** | **4** |

Point distribution is calculated by `calculate_match_points(match_id)`, a PostgreSQL
function that is not defined in the migration file — it must have been created manually
in the DB.

Points flow into `match_points` → `team_statistics.total_points`, and
`points_percentage` is computed as:

```
points_percentage = (total_points / (matches_played * 4)) * 100
```

Standings are read from the `tournament_standings` view (also not defined in any migration),
which orders teams by `current_rank` derived from point totals.

---

## 6. Views and DB Functions

The following database objects are **referenced in code but have no migration**. They
must exist in the database for the application to function correctly.

### View: `tournament_standings`
Used by `getStandings`, `getTeamTournamentStatistics`, and `getTournamentTeamsStatistics`.

Implied columns:
```
team_id, team_name, captain_name, tournament_id,
matches_played, matches_won, matches_lost,
total_score, team_average,
total_points, points_percentage, current_rank,
seed_number, status
```

### View: `player_performance`
Used by `getTournamentPlayersStatistics`.

Implied columns:
```
player_id, player_name, team_id, tournament_id,
games_played, total_pins, current_average,
highest_game, highest_series, matches_played,
tournament_name, team_name
```

### Function: `calculate_match_points(match_id UUID)`
Called automatically by `calculateTeamScoreInMatch` when both teams have submitted scores.

Returns one row with:
```
home_team_id, away_team_id,
home_g1_pts, home_g2_pts, home_g3_pts, home_series_pts, home_total_pts,
away_g1_pts, away_g2_pts, away_g3_pts, away_series_pts, away_total_pts
```

### Trigger: `validate_player_team_assignment_trigger`
Defined in the migration. Fires on INSERT/UPDATE of `team_players`. Prevents a player
from appearing on two different teams in the same league simultaneously.

---

## 7. ERD (Text Representation)

```
leagues
  │  id, name, league_type, status, max_teams_per_tournament
  │
  ├──< tournament_editions
  │      id, league_id, edition_number, name, season, year, status
  │
  └──< tournaments (via league_id, edition_id — both optional)
         id, name, status, max_teams, total_sessions, league_id, edition_id
         │
         ├──< tournament_teams
         │      tournament_id, team_id, seed_number, status
         │      │
         │      └── teams
         │             id, name, captain_name, status
         │
         ├──< team_players
         │      tournament_id, team_id, player_id, role, is_active
         │      │
         │      └── players
         │             id, name, handicap, average_score, total_games_played, total_pins
         │
         ├──< league_sessions
         │      id, tournament_id, session_number, session_name, session_date, status
         │      │
         │      └──< matches
         │             id, tournament_id, session_id, session_number
         │             home_team_id, away_team_id, winner_team_id
         │             status
         │             │
         │             ├──< player_match_scores
         │             │      match_id, team_id, player_id
         │             │      game1_score, game2_score, game3_score, handicap_applied
         │             │
         │             ├──< team_match_scores
         │             │      match_id, team_id
         │             │      total_team_score, total_handicap, team_average, games_played
         │             │
         │             └──  match_points (1:1 with match)
         │                    match_id, home_team_id, away_team_id
         │                    home_game[1-3]_points, home_series_points, home_total_points
         │                    away_game[1-3]_points, away_series_points, away_total_points
         │
         ├──< team_statistics
         │      team_id, tournament_id
         │      total_matches_played, matches_won, matches_lost
         │      total_team_score, team_average
         │      total_points, points_percentage, rank_position
         │
         └──< player_statistics
                player_id, tournament_id, team_id
                games_played, total_pins, current_average
                highest_game, highest_series, matches_played

leagues
  ├──< player_league_eligibility
  │      player_id, league_id, status, reason, effective_date, expiry_date
  │
  └──< team_league_violations
         team_id, league_id, edition_id, player_id
         violation_type, description, status
```

---

## 8. Issues & Gaps

| # | Issue | Impact |
|---|---|---|
| 1 | **Base schema has no migration.** `tournaments`, `teams`, `players`, `matches`, `player_match_scores`, `team_match_scores`, `match_points`, `team_statistics`, `player_statistics`, `league_sessions` all exist with no `.sql` source of truth. A fresh DB cannot be set up reliably. | High |
| 2 | **Views and DB function not in migrations.** `tournament_standings`, `player_performance`, and `calculate_match_points()` are called by the application but have no migration. If the DB is recreated, these will be missing and multiple endpoints will fail with a runtime error. | High |
| 3 | **Two disconnected scoring systems.** System A (match-based, PostgreSQL) is the intended path. System B (`scoreController.js`) writes to in-memory arrays only and is never persisted. Both systems update `players` stats but via different mechanisms, creating a risk of divergence. | High |
| 4 | **`player_statistics` is not auto-updated on score entry.** `team_statistics` is upserted automatically when `calculateTeamScoreInMatch` completes. `player_statistics` is only updated via the manual `PUT /api/player-statistics/:id/:tournamentId` endpoint. The `player_performance` view queries `player_match_scores` directly and is consistent; `player_statistics` is not. | Medium |
| 5 | **`session_number` is denormalized onto `matches`.** Both `session_id` (FK) and `session_number` (integer) exist on `matches`. If a session is renumbered, `matches.session_number` will drift out of sync. | Medium |
| 6 | **`match_points` is 1:1 with `matches` (UNIQUE constraint) but no FK cascade** on `match_points.home_team_id` / `away_team_id` is guaranteed — they duplicate FK logic already expressed via `matches`. | Low |
| 7 | **`tournament_teams.total_tournament_score` and `games_played_in_tournament`** are columns on the join table but are never updated in any controller. Stats are tracked exclusively in `team_statistics` and derived from `player_match_scores`. These columns appear to be dead weight. | Low |
