# Tournament Domain Split Plan

## Problem

`tournamentController.js` is 1267 lines handling 4 distinct responsibilities:
- Tournament CRUD (lines 5–174)
- Registration: teams + player rosters (lines 176–380)
- Scheduling: sessions, round-robin, validation (lines 382–1195)
- Match retrieval (lines 806–950)

`routes/tournaments.js` imports from 3 controllers and wires 31 endpoints.

Additionally, two vestigial controllers do the same thing:
- `sessionsController.js` (30 lines) — `updateSessionStatus`
- `leagueDayController.js` (38 lines) — `updateLeagueDayStatus`
Both update `league_sessions.status`. Both exist. Neither needs to.

## Guiding Principles

1. **Don't change the API surface.** URLs stay the same. This is a code-organization refactor only.
2. **One controller = one domain.** Each controller owns a cohesive set of operations on related resources.
3. **Route files mirror controllers 1:1.** A route file imports from exactly one controller (plus middleware).
4. **Eliminate duplication.** Merge the session/leagueDay controllers. Delete the dead one.
5. **Keep shared helpers local.** If a helper is used by only one controller, it stays in that file. Cross-controller helpers go in `utils/`.

## Target Structure

### Controllers

| File | Domain | Functions | Lines (est.) |
|------|--------|-----------|-------------|
| `controllers/tournamentController.js` | Tournament lifecycle | `createTournament`, `getAllTournaments`, `getTournamentById`, `updateTournament`, `deleteTournament` | ~170 |
| `controllers/registrationController.js` | Team + player registration | `registerTeamToTournament`, `removeTeamFromTournament`, `getRegisteredTeamsInTournament`, `registerPlayerToTeamInTournament`, `removePlayerFromTournamentRoster`, `getRegisteredPlayersInRegisteredTeamInTournament` | ~210 |
| `controllers/scheduleController.js` | Sessions, round-robin, schedule ops | `registerSessionToTournament`, `getSessionsForTournament`, `updateSessionStatus`, `previewMatchMaking`, `generateMatches`, `getTournamentSchedule`, `deleteTournamentSchedule`, `validateTournamentSchedule`, `getRoundMatches`, `getAllMatchesForTournament` | ~810 |
| `controllers/scoresController.js` | Score CRUD (both formats) | `submitScore`, `getScores`, `updateScore`, `deleteScore` | ~716 (unchanged) |
| `controllers/statisticsController.js` | Standings + stats | all current functions | ~451 (unchanged) |
| `controllers/matchesController.js` | Match-specific ops | all current functions | ~389 (unchanged) |
| `controllers/playerController.js` | Player CRUD + dashboard | all current functions | unchanged |
| `controllers/teamController.js` | Team CRUD | all current functions | unchanged |
| `controllers/leagueController.js` | League + editions | all current functions | unchanged |

### Route Files

| File | Mount Point | Sources |
|------|-------------|---------|
| `routes/tournaments.js` | `/api/tournaments` | tournamentController |
| `routes/registration.js` | `/api/tournaments` | registrationController |
| `routes/schedule.js` | `/api/tournaments` | scheduleController |
| `routes/scoring.js` | `/api/tournaments` | scoresController |
| `routes/standings.js` | `/api/tournaments` | statisticsController |
| `routes/matches.js` | `/api/matches` | matchesController |
| `routes/players.js` | `/api/players` | playerController, leagueController |
| `routes/teams.js` | `/api/teams` | teamController |
| `routes/leagues.js` | `/api/leagues` | leagueController |
| `routes/playerStatistics.js` | `/api/player-statistics` | statisticsController |
| `routes/teamStatistics.js` | `/api/team-statistics` | statisticsController |

### Deleted Files

| File | Reason |
|------|--------|
| `controllers/sessionsController.js` | `updateSessionStatus` moves into `scheduleController.js` |
| `controllers/leagueDayController.js` | Duplicate of sessionsController — delete entirely |
| `routes/sessions.js` | `PUT /:id/status` moves to `routes/schedule.js` as `PUT /sessions/:id/status` under `/api/tournaments` mount, or stays standalone — see open question below |

### server.js Mount Changes

```js
// Before (one mount, one route file)
app.use('/api/tournaments', outputFormatter, tournamentRoutes);
app.use('/api/sessions', outputFormatter, sessionRoutes);

// After (multiple route files, same mount point)
app.use('/api/tournaments', outputFormatter, tournamentRoutes);
app.use('/api/tournaments', outputFormatter, registrationRoutes);
app.use('/api/tournaments', outputFormatter, scheduleRoutes);
app.use('/api/tournaments', outputFormatter, scoringRoutes);
app.use('/api/tournaments', outputFormatter, standingsRoutes);
// sessions route removed — updateSessionStatus absorbed into scheduleRoutes
```

Multiple routers can share a mount point. Express merges them. No URL changes.

## Function-to-Controller Mapping

### From `tournamentController.js` (1267 lines) → 3 files

**tournamentController.js** (stays, shrinks to ~170 lines):
```
createTournament          (line 5)
getAllTournaments          (line 54)
getTournamentById         (line 64)
updateTournament          (line 79)
deleteTournament          (line 152)
```

**registrationController.js** (new, ~210 lines):
```
registerTeamToTournament                              (line 176)
getRegisteredTeamsInTournament                        (line 235)
removeTeamFromTournament                              (line 1221)
registerPlayerToTeamInTournament                      (line 273)
getRegisteredPlayersInRegisteredTeamInTournament      (line 343)
removePlayerFromTournamentRoster                      (line 1196)
```

**scheduleController.js** (new, ~810 lines):
```
registerSessionToTournament     (line 382)
getSessionsForTournament        (line 952)
updateSessionStatus             (from sessionsController.js)
previewMatchMaking              (line 438)
generateMatches                 (line 1048)
getTournamentSchedule           (line 508)
deleteTournamentSchedule        (line 990)
validateTournamentSchedule      (line 641)
getRoundMatches                 (line 806)
getAllMatchesForTournament       (line 904)
```

### From `sessionsController.js` (30 lines) → absorbed

`updateSessionStatus` moves into `scheduleController.js`. Identical function already exists as `leagueDayController.updateLeagueDayStatus` — pick one, delete both source files.

## Route-to-File Mapping

### `routes/tournaments.js` (shrinks to 5 routes)

```js
const { createTournament, getAllTournaments, getTournamentById, updateTournament, deleteTournament } = require('../controllers/tournamentController');

router.post('/', createTournament);
router.get('/', getAllTournaments);
router.get('/:id', getTournamentById);
router.put('/:id', updateTournament);
router.delete('/:id', deleteTournament);
```

### `routes/registration.js` (new, 6 routes)

```js
const { ... } = require('../controllers/registrationController');

router.post('/:tournamentId/teams', registerTeamToTournament);
router.get('/:tournamentId/teams', getRegisteredTeamsInTournament);
router.delete('/:tournamentId/teams/:teamId', removeTeamFromTournament);
router.post('/:tournamentId/teams/:teamId/players', registerPlayerToTeamInTournament);
router.get('/:tournamentId/teams/:teamId/players', getRegisteredPlayersInRegisteredTeamInTournament);
router.delete('/:tournamentId/teams/:teamId/players/:playerId', removePlayerFromTournamentRoster);
```

### `routes/schedule.js` (new, 10 routes)

```js
const { ... } = require('../controllers/scheduleController');

router.post('/:tournamentId/sessions', registerSessionToTournament);
router.get('/:tournamentId/sessions', getSessionsForTournament);
router.get('/:tournamentId/sessions/:sessionNumber/matches', getRoundMatches);
router.get('/:tournamentId/schedule/round-robin/preview', previewMatchMaking);
router.post('/:tournamentId/schedule/round-robin', generateMatches);
router.get('/:tournamentId/schedule/summary', getTournamentSchedule);
router.delete('/:tournamentId/schedule', deleteTournamentSchedule);
router.get('/:tournamentId/schedule/validate', validateTournamentSchedule);
router.post('/:tournamentId/matches', createMatch);
router.get('/:tournamentId/matches', getAllMatchesForTournament);
```

### `routes/scoring.js` (new, 4 routes)

```js
const { submitScore, getScores, updateScore, deleteScore } = require('../controllers/scoresController');

router.post('/:tournamentId/sessions/:sessionNumber/scores', submitScore);
router.get('/:tournamentId/sessions/:sessionNumber/scores', getScores);
router.put('/:tournamentId/sessions/:sessionNumber/scores/:playerId', updateScore);
router.delete('/:tournamentId/sessions/:sessionNumber/scores/:playerId', deleteScore);
```

### `routes/standings.js` (new, 6 routes)

```js
const { getStandings, getStatistics, getPlayerTournamentStatistics, getTeamTournamentStatistics, getTournamentPlayersStatistics, getTournamentTeamsStatistics } = require('../controllers/statisticsController');

router.get('/:tournamentId/standings', getStandings);
router.get('/:tournamentId/statistics', getStatistics);
router.get('/:tournamentId/players/:playerId/statistics', getPlayerTournamentStatistics);
router.get('/:tournamentId/teams/:teamId/statistics', getTeamTournamentStatistics);
router.get('/:tournamentId/player-statistics', getTournamentPlayersStatistics);
router.get('/:tournamentId/team-statistics', getTournamentTeamsStatistics);
```

## Open Question

**`PUT /api/sessions/:id/status`** — this is currently mounted at `/api/sessions`, not `/api/tournaments`. Two options:

1. **Keep it standalone** at `/api/sessions/:id/status`. It operates on a session by ID, no tournament context needed. Move the handler into `scheduleController.js` but keep a thin `routes/sessions.js` that mounts at `/api/sessions`.

2. **Move it** to `/api/tournaments/:tournamentId/sessions/:sessionId/status`. More consistent but requires a URL change and the tournament ID is redundant (session ID is globally unique).

Recommendation: **option 1** — keep the URL, just consolidate the handler.

## Implementation Steps

| Step | Action | Risk |
|------|--------|------|
| 1 | Create `controllers/registrationController.js` — extract 6 functions from tournamentController | None — pure move |
| 2 | Create `controllers/scheduleController.js` — extract 10 functions from tournamentController + absorb `updateSessionStatus` | None — pure move |
| 3 | Trim `controllers/tournamentController.js` to 5 CRUD functions | None — deletions only |
| 4 | Delete `controllers/sessionsController.js` and `controllers/leagueDayController.js` | None — absorbed |
| 5 | Create `routes/registration.js`, `routes/schedule.js`, `routes/scoring.js`, `routes/standings.js` | None — new files |
| 6 | Trim `routes/tournaments.js` to 5 CRUD routes | None — routes moved, not deleted |
| 7 | Update `routes/sessions.js` to import from `scheduleController` instead of `sessionsController` | None |
| 8 | Update `server.js` — add new route mounts, remove dead ones | Low — order matters for Express middleware |
| 9 | Run `npm test` — all 37 tests must pass | Verification |

No database changes. No API changes. No test rewrites. If a test breaks, it means a function wasn't moved correctly.

## Verification

- `npm test` — 37 tests pass
- Every endpoint in `CURRENT_SERVICE_ANALYSIS.md` still responds with the same status codes
- `tournamentController.js` drops from 1267 to ~170 lines
- No controller imports from another controller (except shared utils)
