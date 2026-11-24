# Implementation Roadmap

MVP roadmap for the bowling-tourney-service. Each phase delivers a usable, testable slice. Phases are sequential -- each builds on the previous.

Reference: [Access Control Model](./access-control-model.md)

---

## Migration Strategy

New flat routes are built alongside existing ones. Old routes are **deprecated** (kept functional but logged with a warning), then **removed** once the new route has passing tests. This avoids breaking shared controller logic mid-phase.

Per phase:
1. Build new route, reuse or refactor existing controller logic
2. Add tests for the new route
3. Mark old route as deprecated (log warning on hit)
4. Remove old route in a follow-up pass

---

## Phase 1 -- Foundation & Identity

**Goal:** Establish who the user is and what they belong to. Everything downstream depends on this.

### API Surface

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/me/teams` | List my teams (with league + tournament context) |
| GET | `/api/me/leagues` | List leagues I'm part of (derived from team membership) |
| GET | `/api/me/dashboard` | Active teams, recent scores, stats summary |
| GET | `/api/me/statistics` | My tournament stats |
| GET | `/api/me/league-history` | My league participation history |
| GET | `/api/players` | List all players |
| POST | `/api/players` | Create player (manual) |
| GET | `/api/players/:id` | Get player profile |
| DELETE | `/api/players/:id` | Delete player (only if no scores) |
| GET | `/api/teams` | List all teams |
| POST | `/api/teams` | Create team |
| GET | `/api/teams/:id` | Get team details |
| PUT | `/api/teams/:id` | Update team |
| DELETE | `/api/teams/:id` | Delete team (only if not in tournaments) |

### Work Items

- [ ] Fix `requireTeamContext` middleware: remove `req.params.id` fallback (too greedy -- catches player IDs, not just team IDs). Team routes should use explicit `req.params.teamId`.
- [ ] Build `/api/me/*` endpoints (resolve player from JWT, query `team_players` for membership)
- [ ] Refactor existing `/api/players/:playerId/dashboard|teams|statistics|league-history` into `/api/me/*`
- [ ] Keep `/api/players/:id` for looking up other players (scoped by league membership per RBAC doc)
- [ ] Tests for `/api/me/*` endpoints
- [ ] Tests for JWT auth flow + lazy player provisioning
- [ ] Update `bowling_api_oas.yaml`: add `/api/me/*` endpoints, mark deprecated player routes
- [ ] Remove or consolidate duplicate OAS file (`main_api_spec.yaml`)

### Deliverable

A logged-in user can see who they are, which teams they're on, and which leagues they participate in.

---

## Phase 2 -- League & Tournament Management

**Goal:** Admins can set up leagues and tournaments. Teams can register.

### API Surface

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/leagues` | List all leagues (filter: `?status=`, `?type=`) |
| POST | `/api/leagues` | Create league (superadmin) |
| GET | `/api/leagues/:id` | Get league details |
| PUT | `/api/leagues/:id` | Update league (superadmin / league admin) |
| POST | `/api/leagues/:leagueId/admins` | Assign league admin (superadmin) |
| DELETE | `/api/leagues/:leagueId/admins/:playerId` | Remove league admin (superadmin) |
| GET | `/api/leagues/:leagueId/violations` | List rule violations |
| POST | `/api/leagues/validate-assignment` | Validate player-team assignment |
| GET | `/api/tournaments` | List tournaments (filter: `?leagueId=`) |
| POST | `/api/tournaments` | Create tournament (`leagueId` in body) |
| GET | `/api/tournaments/:id` | Get tournament details |
| PUT | `/api/tournaments/:id` | Update tournament |
| DELETE | `/api/tournaments/:id` | Delete tournament |
| POST | `/api/registrations/teams` | Register team to tournament (`tournamentId` in body) |
| GET | `/api/registrations/teams` | List registered teams (`?tournamentId=`) |
| DELETE | `/api/registrations/teams/:teamId` | Unregister team (`?tournamentId=`) |
| POST | `/api/registrations/players` | Add player to roster (`tournamentId`, `teamId` in body) |
| GET | `/api/registrations/players` | List roster (`?tournamentId=&teamId=`) |
| DELETE | `/api/registrations/players/:playerId` | Remove from roster (`?tournamentId=&teamId=`) |

### Work Items

- [ ] Create `league_admins` table migration: `(player_id, league_id, assigned_at, assigned_by)` -- PK on `(player_id, league_id)`. Role type comes from JWT claim, this table only scopes league assignment.
- [ ] Build `resolveRoles` middleware: read `superadmin`/`league_admin` from JWT roles claim; if `league_admin`, query `league_admins` to load `req.player.adminOfLeagues`
- [ ] Build `authorize(permission)` middleware
- [ ] Wire RBAC into league endpoints (superadmin for create, league admin for update)
- [ ] Wire RBAC into tournament endpoints (superadmin + league admin)
- [ ] Flatten registration routes into `/api/registrations/*`
- [ ] Add league admin management endpoints (`POST/DELETE /api/leagues/:leagueId/admins`)
- [ ] Tests for RBAC enforcement on all endpoints
- [ ] Tests for registration flow with role checks
- [ ] Enrich `GET /api/teams/:id` response: include roster (from `team_players`) and tournament/league enrollments (from `tournament_teams → tournaments → leagues`)

### Deliverable

A superadmin can create leagues and appoint admins. League admins can create tournaments. Captains can register their teams. Role violations are caught.

---

## Phase 3 -- Sessions & Schedule

**Goal:** League admins can create sessions and generate match schedules.

### API Surface

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/sessions` | Create session (`tournamentId` in body) |
| GET | `/api/sessions` | List sessions (`?tournamentId=`) |
| PUT | `/api/sessions/:id/status` | Update session status |
| GET | `/api/schedule/preview` | Preview round-robin (`?tournamentId=`) |
| POST | `/api/schedule/generate` | Generate & persist schedule (`tournamentId` in body) |
| GET | `/api/schedule/summary` | Get full schedule (`?tournamentId=`) |
| DELETE | `/api/schedule` | Delete schedule (`?tournamentId=`) |
| GET | `/api/schedule/validate` | Validate schedule (`?tournamentId=`) |

### Work Items

- [ ] Flatten session routes into `/api/sessions`
- [ ] Flatten schedule routes into `/api/schedule`
- [ ] Wire RBAC (league admin + superadmin for writes)
- [ ] Tests for session and schedule endpoints

### Deliverable

League admins can set up the full session/schedule structure for a tournament. Read access for all authenticated users.

---

## Phase 4 -- Scoring & Matches

**Goal:** Players submit scores. Match results are auto-calculated.

### API Surface

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/scores` | Submit player scores (`tournamentId`, `sessionNumber`, `teamId` in body; `matchId` resolved internally for paired format) |
| GET | `/api/scores` | Get scores (`?tournamentId=&sessionNumber=`) |
| PUT | `/api/scores/:playerId` | Update score (`?tournamentId=&sessionNumber=`) |
| DELETE | `/api/scores/:playerId` | Delete score (`?tournamentId=&sessionNumber=`) |
| GET | `/api/matches` | List matches (`?tournamentId=`, `?sessionNumber=`) |
| GET | `/api/matches/:matchId` | Get match details (includes auto-calculated team scores + points) |
| PUT | `/api/matches/:matchId/status` | Update match status |
| POST | `/api/matches` | Manually create a match (`tournamentId`, `sessionId` in body) |

### Work Items

- [ ] Flatten score routes into `/api/scores`
- [ ] Flatten match routes into `/api/matches`
- [ ] Remove manual `team-scores` and `calculate` endpoints
- [ ] Auto-calculate team scores + match points when all player scores for a match are submitted
- [ ] Wire RBAC on score submission (captain: team scores, regular/substitute: own scores only, league admin: any score in their league)
- [ ] RLS cleanup: keep only on `scores` and `team_players`, drop from all other tables
- [ ] Tests for scoring flow with auto-calculation
- [ ] Tests for RBAC on score operations

### Deliverable

Players and captains submit scores through a single endpoint. Match results and point breakdowns are derived automatically. No manual calculation step.

---

## Phase 5 -- Standings, Statistics & Public Access

**Goal:** Leaderboards and stats are available. Public read access for spectators.

### API Surface

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/standings` | Public | Tournament standings (`?tournamentId=`) |
| GET | `/api/statistics` | Public | Aggregate tournament stats (`?tournamentId=`) |
| GET | `/api/statistics/players` | Auth | All player stats in tournament (`?tournamentId=`) |
| GET | `/api/statistics/players/:playerId` | Auth | Single player stats (`?tournamentId=`) |
| GET | `/api/statistics/teams` | Auth | All team stats in tournament (`?tournamentId=`) |
| GET | `/api/statistics/teams/:teamId` | Auth | Single team stats (`?tournamentId=`) |
| PUT | `/api/statistics/players/:playerId` | Admin | Manual stat correction (`?tournamentId=`) |
| PUT | `/api/statistics/teams/:teamId` | Admin | Manual stat correction (`?tournamentId=`) |

### Work Items

- [ ] Flatten standings/statistics into `/api/standings` and `/api/statistics/*`
- [ ] Remove old `/api/player-statistics` and `/api/team-statistics` top-level routes
- [ ] Add public (no-auth) access for standings and aggregate stats
- [ ] Restrict player profile visibility by league membership (per RBAC doc)
- [ ] Restrict player contact info to self/captain/league admin
- [ ] Tests for public vs authenticated access
- [ ] Tests for profile visibility scoping

### Deliverable

Spectators can view leaderboards and match results without logging in. Authenticated users see player profiles scoped to their league. Contact info is protected.

---

## Migration & Cleanup (ongoing across phases)

These items are addressed as each phase is implemented:

- [ ] Create `league_roles` table (Phase 2)
- [ ] Drop RLS from tables other than `scores` and `team_players` (Phase 4)
- [ ] Remove dead `team_match_scores` / manual calculation endpoints (Phase 4)
- [ ] Clean up unused controller methods as routes are consolidated
- [ ] Update OpenAPI spec (`bowling_api_oas.yaml`) to reflect new endpoints per phase
