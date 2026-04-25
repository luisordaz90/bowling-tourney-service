# Bowling Tournament Service — Current State Analysis

Generated: 2026-04-11

---

## 1. Supported API Routes

### `/api/tournaments`

| Method | Path | Handler | Source |
|--------|------|---------|--------|
| POST | `/` | createTournament | tournamentController |
| GET | `/` | getAllTournaments | tournamentController |
| GET | `/:id` | getTournamentById | tournamentController |
| PUT | `/:id` | updateTournament | tournamentController |
| DELETE | `/:id` | deleteTournament | tournamentController |
| POST | `/:tournamentId/teams` | registerTeamToTournament | tournamentController |
| GET | `/:tournamentId/teams` | getRegisteredTeamsInTournament | tournamentController |
| DELETE | `/:tournamentId/teams/:teamId` | removeTeamFromTournament | tournamentController |
| POST | `/:tournamentId/teams/:teamId/players` | registerPlayerToTeamInTournament | tournamentController |
| GET | `/:tournamentId/teams/:teamId/players` | getRegisteredPlayersInRegisteredTeamInTournament | tournamentController |
| DELETE | `/:tournamentId/teams/:teamId/players/:playerId` | removePlayerFromTournamentRoster | tournamentController |
| POST | `/:tournamentId/sessions` | registerSessionToTournament | tournamentController |
| GET | `/:tournamentId/sessions` | getSessionsForTournament | tournamentController |
| GET | `/:tournamentId/sessions/:sessionNumber/matches` | getRoundMatches | tournamentController |
| POST | `/:tournamentId/sessions/:sessionNumber/scores` | submitScore | scoresController |
| GET | `/:tournamentId/sessions/:sessionNumber/scores` | getScores | scoresController |
| PUT | `/:tournamentId/sessions/:sessionNumber/scores/:playerId` | updateScore | scoresController |
| DELETE | `/:tournamentId/sessions/:sessionNumber/scores/:playerId` | deleteScore | scoresController |
| GET | `/:tournamentId/standings` | getStandings | statisticsController |
| GET | `/:tournamentId/statistics` | getStatistics | statisticsController |
| GET | `/:tournamentId/players/:playerId/statistics` | getPlayerTournamentStatistics | statisticsController |
| GET | `/:tournamentId/teams/:teamId/statistics` | getTeamTournamentStatistics | statisticsController |
| GET | `/:tournamentId/player-statistics` | getTournamentPlayersStatistics | statisticsController |
| GET | `/:tournamentId/team-statistics` | getTournamentTeamsStatistics | statisticsController |
| GET | `/:tournamentId/schedule/round-robin/preview` | previewMatchMaking | tournamentController |
| POST | `/:tournamentId/schedule/round-robin` | generateMatches | tournamentController |
| GET | `/:tournamentId/schedule/summary` | getTournamentSchedule | tournamentController |
| DELETE | `/:tournamentId/schedule` | deleteTournamentSchedule | tournamentController |
| GET | `/:tournamentId/schedule/validate` | validateTournamentSchedule | tournamentController |
| POST | `/:tournamentId/matches` | createMatch | matchesController |
| GET | `/:tournamentId/matches` | getAllMatchesForTournament | tournamentController |

### `/api/matches`

| Method | Path | Handler | Source |
|--------|------|---------|--------|
| GET | `/:matchId` | getMatchById | matchesController |
| PUT | `/:matchId/status` | updateMatchStatus | matchesController |
| GET | `/:matchId/player-scores` | getPlayersMatchScore | matchesController |
| POST | `/:matchId/team-scores` | addTeamScoreInMatch | matchesController |
| GET | `/:matchId/team-scores` | getTeamsScoreInMatch | matchesController |
| POST | `/:matchId/team-scores/calculate` | calculateTeamScoreInMatch | matchesController |

### `/api/teams`

| Method | Path | Handler | Source |
|--------|------|---------|--------|
| GET | `/` | getTeams | teamController |
| POST | `/` | createTeam | teamController |
| GET | `/:id` | getTeamById | teamController |
| PUT | `/:id` | updateTeam | teamController |
| DELETE | `/:id` | deleteTeam | teamController |

### `/api/players`

| Method | Path | Handler | Source |
|--------|------|---------|--------|
| POST | `/` | createPlayer | playerController |
| GET | `/` | getPlayers | playerController |
| GET | `/:id` | getPlayerById | playerController |
| DELETE | `/:id` | deletePlayer | playerController |
| GET | `/:playerId/dashboard` | getPlayerDashboard | playerController |
| GET | `/:playerId/teams` | getPlayerTeams | playerController |
| GET | `/:playerId/statistics` | getPlayerStatistics | playerController |
| GET | `/:playerId/league-history` | getPlayerLeagueHistory | leagueController |

### `/api/leagues`

| Method | Path | Handler | Source |
|--------|------|---------|--------|
| POST | `/` | createLeague | leagueController |
| GET | `/` | getLeagues | leagueController |
| GET | `/:id` | getLeagueById | leagueController |
| PUT | `/:id` | updateLeague | leagueController |
| POST | `/:leagueId/editions` | createTournamentEdition | leagueController |
| GET | `/:leagueId/editions` | getLeagueEditions | leagueController |
| GET | `/:leagueId/editions/:editionId` | getTournamentEditionById | leagueController |
| POST | `/validate-assignment` | validatePlayerTeamAssignment | leagueController |
| GET | `/:leagueId/violations` | getLeagueViolations | leagueController |

### `/api/sessions`

| Method | Path | Handler | Source |
|--------|------|---------|--------|
| PUT | `/:id/status` | updateSessionStatus | sessionsController |

### `/api/player-statistics`

| Method | Path | Handler | Source |
|--------|------|---------|--------|
| PUT | `/:playerId/:tournamentId` | updatePlayerStatistics | statisticsController |

### `/api/team-statistics`

| Method | Path | Handler | Source |
|--------|------|---------|--------|
| PUT | `/:teamId/:tournamentId` | updateTeamStatistics | statisticsController |

---

## 2. Database Schema — Relationships

```
leagues
  │
  ├──< tournament_editions    (league_id → leagues.id)
  │       │
  │       └──< tournaments    (edition_id → tournament_editions.id)
  │
  └──< tournaments            (league_id → leagues.id)
          │
          ├──< tournament_teams           (tournament_id → tournaments.id)
          │       └── teams.id            (team_id → teams.id)
          │
          ├──< team_players               (tournament_id → tournaments.id)
          │       ├── teams.id            (team_id → teams.id)
          │       └── players.id          (player_id → players.id)
          │
          ├──< league_sessions            (tournament_id → tournaments.id)
          │       │
          │       └──< scores             (session_id → league_sessions.id)
          │               ├── players.id  (player_id → players.id)
          │               ├── teams.id    (team_id → teams.id, optional)
          │               └── matches.id  (match_id → matches.id, NULL = open format)
          │
          ├──< matches                    (tournament_id → tournaments.id)
          │       ├── teams.id            (home_team_id → teams.id)
          │       ├── teams.id            (away_team_id → teams.id)
          │       ├── teams.id            (winner_team_id → teams.id, NULL until completed)
          │       ├── league_sessions.id  (session_id → league_sessions.id)
          │       │
          │       └──< match_points       (match_id → matches.id, UNIQUE)
          │               ├── teams.id    (home_team_id → teams.id)
          │               └── teams.id    (away_team_id → teams.id)
          │
          ├──< player_statistics          (tournament_id → tournaments.id)
          │       ├── players.id          (player_id → players.id)
          │       └── teams.id            (team_id → teams.id, optional)
          │
          └──< team_statistics            (tournament_id → tournaments.id)
                  └── teams.id            (team_id → teams.id)

players
  ├──< player_league_eligibility  (player_id → players.id)
  │       └── leagues.id          (league_id → leagues.id)
  │
  └──< team_league_violations     (player_id → players.id, optional)
          ├── teams.id            (team_id → teams.id)
          ├── leagues.id          (league_id → leagues.id)
          └── tournament_editions.id (edition_id, optional)
```

### Key constraints

- `scores`: two partial unique indexes split open vs paired format
  - Open: `(session_id, player_id, game_number) WHERE match_id IS NULL`
  - Paired: `(match_id, player_id, game_number) WHERE match_id IS NOT NULL`
- `matches`: `CHECK (home_team_id <> away_team_id)`
- `scores.pins_with_hdcp`: generated column `= score + handicap_applied`
- `team_players`: trigger enforces one-team-per-league-per-player
- `team_players`: trigger enforces solo teams have max 1 player

### Triggers

| Trigger | Table | Events | Purpose |
|---------|-------|--------|---------|
| `trg_recalculate_hdcp` | scores | INSERT, UPDATE, DELETE | Recomputes handicap in `player_statistics` for open-format scores |
| `validate_player_team_assignment` | team_players | INSERT, UPDATE | Prevents player on 2+ teams in same league |
| `enforce_solo_team_size` | team_players | INSERT | Solo teams limited to 1 player |

### Views

| View | Purpose |
|------|---------|
| `tournament_standings` | Teams ranked by total_points, derived from team_statistics |
| `player_performance` | Per-player per-tournament aggregates from scores table |

### Functions

| Function | Purpose |
|----------|---------|
| `calculate_match_points(match_id)` | N-game point breakdown: 1 pt per game won + 1 series pt |
| `recalculate_player_hdcp()` | Trigger function for handicap recalculation |

---

## 3. Dead Code

### Entire files to delete

| File | Reason |
|------|--------|
| `controllers/playerStatisticsController.js` | Replaced by `statisticsController.js`. References undefined model variables — will crash if called. |
| `controllers/teamStatisticsController.js` | Replaced by `statisticsController.js`. References undefined model variables — will crash if called. |
| `controllers/scoreController.js` | Legacy 3-game fixed scoring using in-memory models. Only used by `/api/league-days` routes which themselves are legacy. |
| `models/index.js` | Exports empty in-memory arrays (`leagueDays`, `teams`, `players`, `scores`). All DB access uses `config/database.js`. |
| `routes/scores.js` | Empty router — all score routes live in `routes/tournaments.js`. |
| `routes/statistics.js` | Empty router — all statistics routes live in `routes/tournaments.js`. |

### Functions to delete from active controllers

| Controller | Function | Reason |
|------------|----------|--------|
| `matchesController.js` | `getMatchesByTournament` | Exported but not referenced in any route. `getAllMatchesForTournament` in tournamentController serves this purpose. |
| `matchesController.js` | `getMatchPointsBreakdown` | Exported but not referenced in any route. |
| `playerController.js` | `getPlayersByTeam` | Route in `teams.js` is commented out. |
| `sessionsController.js` | `getSessionById` | Not used in any route. |
| `sessionsController.js` | `getSessionsByTournament` | Not used in any route. |
| `sessionsController.js` | `createSession` | Not used in any route. `registerSessionToTournament` in tournamentController is used instead. |
| `sessionsController.js` | `deleteSession` | Not used in any route. |
| `sessionsController.js` | `updateSession` | Not used in any route. Only `updateSessionStatus` is routed. |
| `leagueDayController.js` | `createLeagueDay` | Exported but not used in `routes/leagueDays.js`. |
| `leagueDayController.js` | `getLeagueDaysByTournament` | Exported but not used in `routes/leagueDays.js`. |

### Legacy routes to evaluate

| Route mount | File | Concern |
|-------------|------|---------|
| `/api/league-days` | `routes/leagueDays.js` | Uses legacy `scoreController.js` with in-memory models. Two endpoints: GET/POST scores by league day. These use the old `game1Score/game2Score/game3Score` pattern and will fail at runtime because the models are empty arrays. |
| `/api/scores` | `routes/scores.js` | Empty router mounted in `server.js` — serves no purpose. |
| `/api/statistics` | `routes/statistics.js` | Empty router mounted in `server.js` — serves no purpose. |

### Commented-out code

| File | Lines | Content |
|------|-------|---------|
| `routes/teams.js` | 12–15 | Three routes commented out: `GET /:teamId/players`, `POST /:teamId/players`, `GET /:teamId/scores` |
