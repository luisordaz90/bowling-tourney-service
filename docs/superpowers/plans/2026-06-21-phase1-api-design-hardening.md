# Phase 1: API Design Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the API consistent, predictable, and easy to build a frontend against — standardized response envelopes, explicit response mappers, proper HTTP status codes, input validation via zod, pagination on lists, and unified error handling.

**Architecture:** Introduce a response helper module and a mapper layer (`mappers/` directory) that all controllers use. Mappers explicitly convert raw DB rows to the API response shape defined in the OAS — no more relying on `outputFormatter` middleware or raw row passthrough. Controllers call `mapper(row)` then `success(res, mapped)`. The `outputFormatter` middleware and all `toCamelCase()` calls in controllers are removed. The OAS (`bowling_api_oas.yaml`) is the source of truth for response shapes.

**Tech Stack:** Express 4, zod (new dependency)

## Global Constraints

- Node.js with Express 4 (CommonJS — `require`/`module.exports`)
- PostgreSQL via `pg` (raw SQL, no ORM)
- All tests use Vitest + supertest
- Run tests with: `npx vitest run --reporter=verbose`
- No TypeScript — plain JavaScript
- OAS reference: `bowling_api_oas.yaml` defines all response schemas
- Existing test files: `tests/utils.test.js`, `tests/tournaments.test.js`, `tests/matches.test.js`, `tests/leagues.test.js`, `tests/sessionEntries.test.js`, `tests/handicap-evolution.test.js`, `tests/e2e-tournament-lifecycle.test.js`

---

### Task 1: Standardized Response Helpers + Error Format (C7, C1)

**Files:**
- Create: `utils/response.js`
- Create: `tests/response.test.js`
- Modify: `middleware/errorHandler.js`

**Interfaces:**
- Produces: `success(res, data, statusCode)`, `created(res, data)`, `paginated(res, data, pagination)`, `noContent(res)`, `fail(res, statusCode, code, message, details)`, `AppError` class
- Produces: Updated `errorHandler` that catches `AppError` instances and unknown errors, always returns `{ error: { code, message } }`

**Context:**
The current error format varies: sometimes `{ error: "string" }`, sometimes `{ message: "string" }`. The `errorHandler` middleware crashes when `err.status` is undefined. Controllers construct success responses inconsistently.

This task creates the foundation all other tasks build on.

- [ ] **Step 1: Write failing tests for response helpers**

```javascript
// tests/response.test.js
const { describe, it, expect, vi } = require('vitest');

// Minimal Express response mock
function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; return res; },
    send() { res.body = null; return res; },
  };
  return res;
}

describe('response helpers', () => {
  let response;

  beforeAll(async () => {
    response = require('../utils/response');
  });

  describe('success', () => {
    it('wraps data in { data } envelope with 200', () => {
      const res = mockRes();
      response.success(res, { id: 1, name: 'Strikers' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ data: { id: 1, name: 'Strikers' } });
    });

    it('accepts custom status code', () => {
      const res = mockRes();
      response.success(res, { id: 1 }, 202);
      expect(res.statusCode).toBe(202);
    });
  });

  describe('created', () => {
    it('returns 201 with data envelope', () => {
      const res = mockRes();
      response.created(res, { id: 'abc' });
      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual({ data: { id: 'abc' } });
    });
  });

  describe('noContent', () => {
    it('returns 204 with no body', () => {
      const res = mockRes();
      response.noContent(res);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBeNull();
    });
  });

  describe('paginated', () => {
    it('wraps data with pagination metadata', () => {
      const res = mockRes();
      const items = [{ id: 1 }, { id: 2 }];
      response.paginated(res, items, { page: 1, pageSize: 10, total: 25 });
      expect(res.body).toEqual({
        data: items,
        pagination: { page: 1, pageSize: 10, total: 25, totalPages: 3 }
      });
    });
  });

  describe('fail', () => {
    it('returns structured error', () => {
      const res = mockRes();
      response.fail(res, 400, 'VALIDATION_ERROR', 'Name is required');
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: { code: 'VALIDATION_ERROR', message: 'Name is required' }
      });
    });

    it('includes details when provided', () => {
      const res = mockRes();
      response.fail(res, 400, 'VALIDATION_ERROR', 'Invalid input', [
        { field: 'name', message: 'Required' }
      ]);
      expect(res.body.error.details).toEqual([
        { field: 'name', message: 'Required' }
      ]);
    });
  });

  describe('AppError', () => {
    it('carries status, code, and message', () => {
      const err = new response.AppError(404, 'NOT_FOUND', 'Player not found');
      expect(err).toBeInstanceOf(Error);
      expect(err.status).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toBe('Player not found');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/response.test.js --reporter=verbose`
Expected: FAIL — `Cannot find module '../utils/response'`

- [ ] **Step 3: Implement response helpers**

```javascript
// utils/response.js

const success = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({ data });
};

const created = (res, data) => {
  return success(res, data, 201);
};

const noContent = (res) => {
  return res.status(204).send();
};

const paginated = (res, data, { page, pageSize, total }) => {
  return res.json({
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
};

const fail = (res, statusCode, code, message, details) => {
  const body = { error: { code, message } };
  if (details) body.error.details = details;
  return res.status(statusCode).json(body);
};

class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = { success, created, noContent, paginated, fail, AppError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/response.test.js --reporter=verbose`
Expected: All 7 tests PASS

- [ ] **Step 5: Write failing test for updated errorHandler**

Add to `tests/response.test.js`:

```javascript
describe('errorHandler middleware', () => {
  let errorHandler;

  beforeAll(async () => {
    delete require.cache[require.resolve('../middleware/errorHandler')];
    ({ errorHandler } = require('../middleware/errorHandler'));
  });

  it('handles AppError with structured response', () => {
    const { AppError } = require('../utils/response');
    const err = new AppError(404, 'NOT_FOUND', 'Player not found');
    const res = mockRes();
    const next = vi.fn();
    errorHandler(err, {}, res, next);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Player not found' }
    });
  });

  it('handles generic Error without status (defaults to 500)', () => {
    const err = new Error('Something broke');
    const res = mockRes();
    const next = vi.fn();
    errorHandler(err, {}, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  });

  it('handles error with status but no code', () => {
    const err = new Error('Bad input');
    err.status = 400;
    const res = mockRes();
    const next = vi.fn();
    errorHandler(err, {}, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toBe('Bad input');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/response.test.js --reporter=verbose`
Expected: FAIL — errorHandler still uses old format

- [ ] **Step 7: Update errorHandler**

```javascript
// middleware/errorHandler.js
const logger = require('../config/logger');
const { AppError } = require('../utils/response');

const errorHandler = (err, req, res, next) => {
  logger.error({ err, url: req.originalUrl, method: req.method }, err.message);

  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message }
    });
  }

  const status = err.status || 500;
  const message = status === 500 ? 'Internal server error' : err.message;
  const code = err.code || (status === 500 ? 'INTERNAL_ERROR' : 'ERROR');

  return res.status(status).json({
    error: { code, message }
  });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' }
  });
};

module.exports = { errorHandler, notFoundHandler };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/response.test.js --reporter=verbose`
Expected: All 10 tests PASS

- [ ] **Step 9: Run full test suite to check for regressions**

Run: `npx vitest run --reporter=verbose`
Expected: All existing tests PASS. Some tests may need the error response shape updated (`{ error: "string" }` → `{ error: { code, message } }`). If tests fail, update assertions in the failing test files to match the new error format.

- [ ] **Step 10: Commit**

```bash
git add utils/response.js tests/response.test.js middleware/errorHandler.js
git commit -m "feat: add standardized response helpers and fix errorHandler

Introduces utils/response.js with success/created/paginated/noContent/fail
helpers and AppError class. Updates errorHandler to handle undefined
err.status and return structured { error: { code, message } } format."
```

---

### Task 2: Create Response Mapper Layer (C1, C2)

**Files:**
- Create: `mappers/tournament.js`
- Create: `mappers/player.js`
- Create: `mappers/team.js`
- Create: `mappers/league.js`
- Create: `mappers/match.js`
- Create: `mappers/session.js`
- Create: `mappers/score.js`
- Create: `mappers/statistics.js`
- Create: `mappers/registration.js`
- Create: `tests/mappers.test.js`

**Interfaces:**
- Produces: Per-resource mapper functions that convert snake_case DB rows to camelCase API response objects matching the OAS schemas
- Consumes: OAS component schemas in `bowling_api_oas.yaml` as the source of truth for field names and shapes

**Context:**
Currently controllers return raw DB rows, relying on the `outputFormatter` middleware (`toCamelCase`) to convert field names. This is implicit and fragile — any column rename or JOIN change silently changes the API contract. Mappers make the contract explicit: each function picks exactly the fields defined in the OAS and converts them to camelCase. This replaces `outputFormatter` entirely.

Each mapper file exports functions named `to<Resource>Response` for single items and `to<Resource>ListResponse` for arrays (which just maps over the single-item function).

- [ ] **Step 1: Write failing tests for tournament mapper**

```javascript
// tests/mappers.test.js
const { describe, it, expect } = require('vitest');

describe('tournament mapper', () => {
  let mapper;

  beforeAll(() => {
    mapper = require('../mappers/tournament');
  });

  it('maps a DB row to API response shape', () => {
    const row = {
      id: '123',
      name: 'Fall Classic',
      description: 'Annual tournament',
      start_date: '2026-09-01',
      end_date: '2026-12-01',
      max_teams: 8,
      total_sessions: 14,
      session_type: 'weekly',
      status: 'draft',
      sessions_completed: 0,
      league_id: '456',
      schedule_type: 'paired',
      ranking_method: 'points',
      hdcp_base: 220,
      hdcp_percentage: '0.90',
      season: 'fall',
      year: 2026,
      games_per_session: 3,
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
      // Extra columns that should NOT leak
      some_internal_field: 'secret',
    };

    const result = mapper.toTournamentResponse(row);

    expect(result).toEqual({
      id: '123',
      name: 'Fall Classic',
      description: 'Annual tournament',
      startDate: '2026-09-01',
      endDate: '2026-12-01',
      maxTeams: 8,
      totalSessions: 14,
      sessionType: 'weekly',
      status: 'draft',
      sessionsCompleted: 0,
      leagueId: '456',
      scheduleType: 'paired',
      rankingMethod: 'points',
      hdcpBase: 220,
      hdcpPercentage: '0.90',
      season: 'fall',
      year: 2026,
      gamesPerSession: 3,
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    });

    // Must NOT include unexpected fields
    expect(result).not.toHaveProperty('someInternalField');
    expect(result).not.toHaveProperty('some_internal_field');
  });

  it('maps an array of rows', () => {
    const rows = [
      { id: '1', name: 'T1', description: null, start_date: '2026-01-01', end_date: '2026-06-01', max_teams: 4, total_sessions: 3, session_type: 'weekly', status: 'draft', sessions_completed: 0, league_id: '10', schedule_type: 'paired', ranking_method: 'points', hdcp_base: 220, hdcp_percentage: '0.90', season: null, year: null, games_per_session: 3, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      { id: '2', name: 'T2', description: null, start_date: '2026-01-01', end_date: '2026-06-01', max_teams: 4, total_sessions: 3, session_type: 'weekly', status: 'active', sessions_completed: 1, league_id: '10', schedule_type: 'open', ranking_method: 'pins', hdcp_base: 220, hdcp_percentage: '0.90', season: 'spring', year: 2026, games_per_session: 3, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    ];
    const result = mapper.toTournamentListResponse(rows);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('T1');
    expect(result[1].scheduleType).toBe('open');
  });
});

describe('player mapper', () => {
  let mapper;

  beforeAll(() => {
    mapper = require('../mappers/player');
  });

  it('maps a DB row to API response shape', () => {
    const row = {
      id: '123',
      name: 'John Doe',
      email: 'john@test.com',
      phone: '555-1234',
      handicap: 150,
      average_score: '185.50',
      total_games_played: 42,
      total_pins: 7791,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const result = mapper.toPlayerResponse(row);

    expect(result).toEqual({
      id: '123',
      name: 'John Doe',
      email: 'john@test.com',
      phone: '555-1234',
      handicap: 150,
      averageScore: '185.50',
      totalGamesPlayed: 42,
      totalPins: 7791,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
  });
});

describe('team mapper', () => {
  let mapper;

  beforeAll(() => {
    mapper = require('../mappers/team');
  });

  it('maps a DB row to API response shape', () => {
    const row = {
      id: '123',
      name: 'Strikers',
      captain_name: 'Jane',
      captain_email: 'jane@test.com',
      captain_phone: '555-0000',
      team_type: 'standard',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const result = mapper.toTeamResponse(row);

    expect(result).toEqual({
      id: '123',
      name: 'Strikers',
      captainName: 'Jane',
      captainEmail: 'jane@test.com',
      captainPhone: '555-0000',
      teamType: 'standard',
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
  });
});

describe('league mapper', () => {
  let mapper;

  beforeAll(() => {
    mapper = require('../mappers/league');
  });

  it('maps a DB row to API response shape', () => {
    const row = {
      id: '123',
      name: 'Main League',
      description: 'The main league',
      league_type: 'standard',
      status: 'active',
      max_teams_per_tournament: 12,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const result = mapper.toLeagueResponse(row);

    expect(result).toEqual({
      id: '123',
      name: 'Main League',
      description: 'The main league',
      leagueType: 'standard',
      status: 'active',
      maxTeamsPerTournament: 12,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
  });
});

describe('score mapper', () => {
  let mapper;

  beforeAll(() => {
    mapper = require('../mappers/score');
  });

  it('maps match player scores with gameNumber/score objects', () => {
    const row = {
      player_id: '123',
      team_id: '456',
      player_name: 'John',
      team_name: 'Strikers',
      scores: [{ gameNumber: 1, score: 180 }, { gameNumber: 2, score: 200 }, { gameNumber: 3, score: 220 }],
      handicap_applied: 10,
      created_at: '2026-01-01T00:00:00Z',
    };

    const result = mapper.toMatchPlayerScoreResponse(row);

    expect(result).toEqual({
      playerId: '123',
      teamId: '456',
      playerName: 'John',
      teamName: 'Strikers',
      scores: [{ gameNumber: 1, score: 180 }, { gameNumber: 2, score: 200 }, { gameNumber: 3, score: 220 }],
      handicapApplied: 10,
      createdAt: '2026-01-01T00:00:00Z',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mappers.test.js --reporter=verbose`
Expected: FAIL — `Cannot find module '../mappers/tournament'`

- [ ] **Step 3: Implement tournament mapper**

```javascript
// mappers/tournament.js

const toTournamentResponse = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  startDate: row.start_date,
  endDate: row.end_date,
  maxTeams: row.max_teams,
  totalSessions: row.total_sessions,
  sessionType: row.session_type,
  status: row.status,
  sessionsCompleted: row.sessions_completed,
  leagueId: row.league_id,
  scheduleType: row.schedule_type,
  rankingMethod: row.ranking_method,
  hdcpBase: row.hdcp_base,
  hdcpPercentage: row.hdcp_percentage,
  season: row.season,
  year: row.year,
  gamesPerSession: row.games_per_session,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTournamentListResponse = (rows) => rows.map(toTournamentResponse);

module.exports = { toTournamentResponse, toTournamentListResponse };
```

- [ ] **Step 4: Implement player mapper**

```javascript
// mappers/player.js

const toPlayerResponse = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  handicap: row.handicap,
  averageScore: row.average_score,
  totalGamesPlayed: row.total_games_played,
  totalPins: row.total_pins,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toPlayerListResponse = (rows) => rows.map(toPlayerResponse);

module.exports = { toPlayerResponse, toPlayerListResponse };
```

- [ ] **Step 5: Implement team mapper**

```javascript
// mappers/team.js

const toTeamResponse = (row) => ({
  id: row.id,
  name: row.name,
  captainName: row.captain_name,
  captainEmail: row.captain_email,
  captainPhone: row.captain_phone,
  teamType: row.team_type,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTeamListResponse = (rows) => rows.map(toTeamResponse);

module.exports = { toTeamResponse, toTeamListResponse };
```

- [ ] **Step 6: Implement league mapper**

```javascript
// mappers/league.js

const toLeagueResponse = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  leagueType: row.league_type,
  status: row.status,
  maxTeamsPerTournament: row.max_teams_per_tournament,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toLeagueListResponse = (rows) => rows.map(toLeagueResponse);

module.exports = { toLeagueResponse, toLeagueListResponse };
```

- [ ] **Step 7: Implement score mapper**

```javascript
// mappers/score.js

const toMatchPlayerScoreResponse = (row) => ({
  playerId: row.player_id,
  teamId: row.team_id,
  playerName: row.player_name,
  teamName: row.team_name,
  scores: row.scores,
  handicapApplied: row.handicap_applied,
  createdAt: row.created_at,
});

const toMatchPlayerScoreListResponse = (rows) => rows.map(toMatchPlayerScoreResponse);

const toSessionScoreResponse = (row) => ({
  tournamentId: row.tournament_id,
  sessionNumber: row.session_number,
  playerId: row.player_id,
  playerName: row.player_name,
  teamId: row.team_id,
  teamName: row.team_name,
  matchId: row.match_id,
  scores: row.scores,
  handicapApplied: row.handicap_applied,
  totalPins: row.total_pins,
  sessionAverage: row.session_average,
  recordedAt: row.recorded_at,
});

const toSessionScoreListResponse = (rows) => rows.map(toSessionScoreResponse);

module.exports = {
  toMatchPlayerScoreResponse,
  toMatchPlayerScoreListResponse,
  toSessionScoreResponse,
  toSessionScoreListResponse,
};
```

- [ ] **Step 8: Implement remaining mappers**

Create `mappers/match.js`, `mappers/session.js`, `mappers/statistics.js`, `mappers/registration.js` following the same pattern. Reference the OAS component schemas for each resource's fields:

```javascript
// mappers/match.js
const toMatchResponse = (row) => ({
  id: row.id,
  tournamentId: row.tournament_id,
  homeTeamId: row.home_team_id,
  awayTeamId: row.away_team_id,
  sessionId: row.session_id,
  sessionNumber: row.session_number,
  matchDate: row.match_date,
  matchName: row.match_name,
  status: row.status,
  winnerTeamId: row.winner_team_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  // Enriched fields (present when JOINed)
  ...(row.home_team_name && { homeTeamName: row.home_team_name }),
  ...(row.away_team_name && { awayTeamName: row.away_team_name }),
  ...(row.winner_team_name && { winnerTeamName: row.winner_team_name }),
});

const toMatchListResponse = (rows) => rows.map(toMatchResponse);

module.exports = { toMatchResponse, toMatchListResponse };
```

```javascript
// mappers/session.js
const toSessionResponse = (row) => ({
  id: row.id,
  tournamentId: row.tournament_id,
  sessionNumber: row.session_number,
  sessionName: row.session_name,
  sessionDate: row.session_date,
  status: row.status,
  notes: row.notes,
  createdAt: row.created_at,
  // Enriched fields (present when computed)
  ...(row.match_count != null && { matchCount: parseInt(row.match_count) }),
  ...(row.completed_matches != null && { completedMatches: parseInt(row.completed_matches) }),
  ...(row.scheduled_matches != null && { scheduledMatches: parseInt(row.scheduled_matches) }),
  ...(row.in_progress_matches != null && { inProgressMatches: parseInt(row.in_progress_matches) }),
});

const toSessionListResponse = (rows) => rows.map(toSessionResponse);

module.exports = { toSessionResponse, toSessionListResponse };
```

```javascript
// mappers/statistics.js
const toPlayerTournamentStatsResponse = (row) => ({
  playerId: row.player_id,
  tournamentId: row.tournament_id,
  gamesPlayed: row.games_played,
  totalPins: row.total_pins,
  currentAverage: row.current_average,
  highestGame: row.highest_game,
  highestSeries: row.highest_series,
  matchesPlayed: row.matches_played,
  matchesContributedToWin: row.matches_contributed_to_win,
  currentHandicap: row.current_handicap,
});

const toTeamTournamentStatsResponse = (row) => ({
  teamId: row.team_id,
  tournamentId: row.tournament_id,
  totalMatchesPlayed: row.total_matches_played,
  matchesWon: row.matches_won,
  matchesLost: row.matches_lost,
  totalTeamScore: row.total_team_score,
  teamAverage: row.team_average,
  totalPoints: row.total_points,
  pointsPercentage: row.points_percentage,
  maxPossiblePoints: row.max_possible_points,
  rankPosition: row.rank_position,
});

module.exports = {
  toPlayerTournamentStatsResponse,
  toTeamTournamentStatsResponse,
};
```

```javascript
// mappers/registration.js
const toTournamentTeamResponse = (row) => ({
  id: row.id,
  tournamentId: row.tournament_id,
  teamId: row.team_id,
  seedNumber: row.seed_number,
  totalTournamentScore: row.total_tournament_score,
  gamesPlayedInTournament: row.games_played_in_tournament,
  sessionsPlayedInTournament: row.sessions_played_in_tournament,
  registrationDate: row.registration_date,
  status: row.status,
});

const toTeamPlayerResponse = (row) => ({
  id: row.id,
  teamId: row.team_id,
  playerId: row.player_id,
  tournamentId: row.tournament_id,
  role: row.role,
  isActive: row.is_active,
  joinedDate: row.joined_date,
  leftDate: row.left_date,
});

module.exports = {
  toTournamentTeamResponse,
  toTeamPlayerResponse,
};
```

- [ ] **Step 9: Run test to verify all mappers pass**

Run: `npx vitest run tests/mappers.test.js --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add mappers/ tests/mappers.test.js
git commit -m "feat: add response mapper layer for all resources

Each mapper explicitly converts snake_case DB rows to camelCase API
response objects matching the OAS schemas. Prevents field leakage
and decouples DB schema from API contract."
```

---

### Task 3: Wire Mappers + Remove outputFormatter (C1, C2)

**Files:**
- Modify: `server.js` (remove outputFormatter middleware)
- Modify: `controllers/tournamentController.js`
- Modify: `controllers/playerController.js`
- Modify: `controllers/teamController.js`
- Modify: `controllers/leagueController.js`
- Modify: `controllers/matchesController.js`
- Modify: `controllers/scoresController.js`
- Modify: `controllers/registrationController.js`
- Modify: `controllers/scheduleController.js`
- Modify: `controllers/statisticsController.js`

**Interfaces:**
- Consumes: All mapper functions from Task 2
- Consumes: `success()`, `created()`, `noContent()`, `fail()` from Task 1
- Produces: All controllers return mapped, enveloped responses. No more raw `res.json(result.rows)` or `toCamelCase()` calls.

**Context:**
This is the big wiring task. Every controller function gets updated to:
1. Import its resource mapper
2. Import response helpers
3. Replace `res.json(result.rows[0])` with `success(res, mapper(result.rows[0]))`
4. Replace `res.status(201).json(...)` with `created(res, mapper(...))`
5. Replace error responses with `fail()`

The `outputFormatter` middleware in server.js is removed — mappers handle all casing. All `toCamelCase()` imports are removed from controllers.

- [ ] **Step 1: Run full test suite to establish baseline**

Run: `npx vitest run --reporter=verbose`
Expected: Note pass count.

- [ ] **Step 2: Remove outputFormatter from server.js**

Remove the `outputFormatter` middleware definition and all references to it in route mounting:

Before:
```javascript
const outputFormatter = (req, res, next) => {
    const originalJson = res.json;
    res.json = function (body) {
        originalJson.call(this, toCamelCase(body));
    }
    next();
};

app.use('/api/tournaments', outputFormatter, tournamentRoutes);
app.use('/api/teams', outputFormatter, teamRoutes);
// etc.
```

After:
```javascript
// outputFormatter removed — mappers handle response shapes

app.use('/api/tournaments', tournamentRoutes);
app.use('/api/teams', teamRoutes);
// etc.
```

Also remove the `toCamelCase` import from server.js if it's only used for `outputFormatter`.

- [ ] **Step 3: Wire mappers into tournamentController.js**

```javascript
const { toTournamentResponse, toTournamentListResponse } = require('../mappers/tournament');
const { success, created, noContent, fail } = require('../utils/response');

// createTournament
// Before: res.status(201).json(toCamelCase(result.rows[0]));
// After:
created(res, toTournamentResponse(result.rows[0]));

// getAllTournaments
// Before: res.json(toCamelCase(result.rows));
// After:
success(res, toTournamentListResponse(result.rows));

// getTournamentById
// Before: res.json(toCamelCase(result.rows[0]));
// After:
success(res, toTournamentResponse(result.rows[0]));

// updateTournament
// Before: res.json(toCamelCase(result.rows[0]));
// After:
success(res, toTournamentResponse(result.rows[0]));

// deleteTournament
// Before: res.status(204).send();
// After:
noContent(res);

// All error responses:
// Before: res.status(404).json({ error: 'Tournament not found' });
// After:
fail(res, 404, 'NOT_FOUND', 'Tournament not found');
```

Remove `toCamelCase` import.

- [ ] **Step 4: Wire mappers into playerController.js**

Same pattern with `toPlayerResponse`/`toPlayerListResponse`. The dashboard endpoint constructs a composite object — map each sub-property:

```javascript
const { toPlayerResponse } = require('../mappers/player');
const { toTeamResponse } = require('../mappers/team');

// Dashboard
success(res, {
  player: toPlayerResponse(player),
  currentTeams: currentTeamsResult.rows.map(toTeamResponse),
  // etc.
});
```

- [ ] **Step 5: Wire mappers into teamController.js, leagueController.js**

Same pattern with their respective mappers.

- [ ] **Step 6: Wire mappers into matchesController.js**

Use `toMatchResponse` for match detail, `toMatchPlayerScoreListResponse` for player scores, etc.

- [ ] **Step 7: Wire mappers into scoresController.js**

Use `toSessionScoreResponse` for score submissions and retrievals.

- [ ] **Step 8: Wire mappers into registrationController.js, scheduleController.js, statisticsController.js**

Complete the remaining controllers. `scheduleController.js` is the largest — be thorough with session and match mappers.

- [ ] **Step 9: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: Many tests will fail because response shapes changed:
- Success responses now wrapped in `{ data: ... }`
- Error responses now `{ error: { code, message } }` instead of `{ error: "string" }`
- Field names may differ slightly (mapper-defined vs raw row)

Update test assertions to match new shapes. This is expected and necessary.

- [ ] **Step 10: Commit**

```bash
git add server.js controllers/ tests/
git commit -m "refactor: wire response mappers into all controllers, remove outputFormatter

Controllers now use explicit mapper functions to convert DB rows to API
response shapes. outputFormatter middleware removed — no more implicit
toCamelCase on all responses. Response helpers provide consistent
envelopes ({ data }, { error: { code, message } })."
```

---

### Task 4: Fix HTTP Status Codes (C3)

**Files:**
- Modify: `controllers/teamController.js` (lines 33, 131)
- Modify: `controllers/leagueController.js` (lines 27, 127)
- Modify: `controllers/playerController.js` (lines 35, 124)
- Modify: `controllers/scoresController.js` (lines 272, 382)
- Modify: `controllers/registrationController.js`

**Interfaces:**
- Consumes: `fail()` from `utils/response.js` (Task 1)
- Produces: 409 Conflict for duplicate/already-exists errors

**Context:**
All "already exists" and "already registered" errors currently return 400. Per HTTP semantics, these should return 409 Conflict. If Task 3 already migrated these to `fail()` with 400, this task changes them to 409.

- [ ] **Step 1: Write failing test for 409 on duplicate**

```javascript
it('returns 409 when creating team with duplicate name', async () => {
  await request(app)
    .post('/api/teams')
    .send({ name: 'Duplicate Test Team', captainName: 'Captain', captainEmail: 'cap@test.com' });

  const res = await request(app)
    .post('/api/teams')
    .send({ name: 'Duplicate Test Team', captainName: 'Captain2', captainEmail: 'cap2@test.com' });

  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('CONFLICT');
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: returns 400 instead of 409

- [ ] **Step 3: Update all duplicate/conflict responses to 409**

In each controller, find PostgreSQL unique constraint handlers (`error.code === '23505'`) and "already exists"/"already registered" responses. Change from:
```javascript
fail(res, 400, 'VALIDATION_ERROR', 'Team name already exists');
```
To:
```javascript
fail(res, 409, 'CONFLICT', 'Team name already exists');
```

Apply to:
- `teamController.js` — "Team name already exists"
- `leagueController.js` — "League name already exists"
- `playerController.js` — "Email already exists"
- `scoresController.js` — "Score already recorded"
- `registrationController.js` — "Team is already registered"

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: New test passes. Update any existing tests that assert 400 for these scenarios.

- [ ] **Step 5: Commit**

```bash
git add controllers/ tests/
git commit -m "fix: return 409 Conflict for duplicate resource errors

Changes 'already exists' and 'already registered' responses from 400
to 409 with structured error format { error: { code: 'CONFLICT', message } }."
```

---

### Task 5: Change GET /schedule/validate to POST (C4)

**Files:**
- Modify: `routes/schedule.js`
- Modify: `tests/e2e-tournament-lifecycle.test.js` (if it calls this endpoint)

**Interfaces:**
- Consumes: `validateTournamentSchedule` from `scheduleController.js` (unchanged)
- Produces: `POST /:tournamentId/schedule/validate` replaces GET

- [ ] **Step 1: Check if any test calls GET /schedule/validate**

```bash
grep -rn 'schedule/validate' tests/
```

- [ ] **Step 2: Change route from GET to POST**

In `routes/schedule.js`:

Before:
```javascript
router.get('/:tournamentId/schedule/validate', validateTournamentSchedule);
```

After:
```javascript
router.post('/:tournamentId/schedule/validate', validateTournamentSchedule);
```

- [ ] **Step 3: Update any tests that use GET**

Change `.get(` to `.post(` if found.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add routes/schedule.js tests/
git commit -m "fix: change GET /schedule/validate to POST

Validation is an action, not a resource retrieval."
```

---

### Task 6: Add Input Validation with Zod (C6)

**Files:**
- Create: `validation/schemas.js`
- Create: `validation/validate.js`
- Create: `tests/validation.test.js`
- Modify: `package.json` (add zod)
- Modify: routes and controllers for tournament, player, team, league, scoring

**Interfaces:**
- Produces: `validate(schema)` Express middleware that parses `req.body` and calls `fail()` on error
- Produces: Zod schemas for tournament, player, team, league create/update and score submission
- Consumes: `fail()` from `utils/response.js` (Task 1)

**Context:**
All input validation is inline in controllers. Zod schemas centralize validation, provide clear error messages, and strip unknown fields. Note: zod schemas use camelCase field names matching the request body (clients send camelCase). Controllers receive camelCase from `req.body` and convert to snake_case for SQL — this is the inverse of mappers.

- [ ] **Step 1: Install zod**

```bash
cd /Users/luis.ordaz/Projects/bowling-tourney-service
npm install zod
```

- [ ] **Step 2: Write failing tests for validation middleware**

```javascript
// tests/validation.test.js
const { describe, it, expect, vi } = require('vitest');

describe('validation schemas', () => {
  let schemas;

  beforeAll(() => {
    schemas = require('../validation/schemas');
  });

  describe('createTournament', () => {
    it('accepts valid input', () => {
      const result = schemas.createTournament.safeParse({
        name: 'Fall Classic',
        startDate: '2026-09-01',
        endDate: '2026-12-01',
        maxTeams: 8,
        totalSessions: 14,
        sessionType: 'weekly',
        leagueId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required fields', () => {
      const result = schemas.createTournament.safeParse({ name: 'Fall Classic' });
      expect(result.success).toBe(false);
    });

    it('rejects maxTeams < 2', () => {
      const result = schemas.createTournament.safeParse({
        name: 'T', startDate: '2026-09-01', endDate: '2026-12-01',
        maxTeams: 1, totalSessions: 1, sessionType: 'weekly',
        leagueId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid scheduleType', () => {
      const result = schemas.createTournament.safeParse({
        name: 'T', startDate: '2026-09-01', endDate: '2026-12-01',
        maxTeams: 8, totalSessions: 14, sessionType: 'weekly',
        leagueId: '550e8400-e29b-41d4-a716-446655440000',
        scheduleType: 'bracket',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createPlayer', () => {
    it('accepts valid input', () => {
      const result = schemas.createPlayer.safeParse({ name: 'John Doe', email: 'john@example.com' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const result = schemas.createPlayer.safeParse({ name: 'John', email: 'not-an-email' });
      expect(result.success).toBe(false);
    });

    it('accepts name only', () => {
      const result = schemas.createPlayer.safeParse({ name: 'John' });
      expect(result.success).toBe(true);
    });
  });

  describe('createTeam', () => {
    it('rejects missing captainEmail', () => {
      const result = schemas.createTeam.safeParse({ name: 'Strikers', captainName: 'Jane' });
      expect(result.success).toBe(false);
    });
  });

  describe('createLeague', () => {
    it('rejects empty name', () => {
      const result = schemas.createLeague.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('submitScore', () => {
    it('rejects score > 300', () => {
      const result = schemas.submitScore.safeParse({
        playerId: '550e8400-e29b-41d4-a716-446655440000',
        scores: [180, 301, 220],
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty scores array', () => {
      const result = schemas.submitScore.safeParse({
        playerId: '550e8400-e29b-41d4-a716-446655440000',
        scores: [],
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('validate middleware', () => {
  let validate, schemas;

  beforeAll(() => {
    validate = require('../validation/validate');
    schemas = require('../validation/schemas');
  });

  function mockReq(body) { return { body }; }
  function mockRes() {
    const res = { statusCode: 200, body: null, status(c) { res.statusCode = c; return res; }, json(d) { res.body = d; return res; } };
    return res;
  }

  it('calls next() on valid input', () => {
    const req = mockReq({ name: 'Test League' });
    const res = mockRes();
    const next = vi.fn();
    validate(schemas.createLeague)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 with structured error on invalid input', () => {
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();
    validate(schemas.createLeague)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('strips unknown fields from body', () => {
    const req = mockReq({ name: 'Test', hackField: 'malicious' });
    const res = mockRes();
    const next = vi.fn();
    validate(schemas.createLeague)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body.hackField).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/validation.test.js --reporter=verbose`
Expected: FAIL — modules don't exist

- [ ] **Step 4: Implement schemas**

```javascript
// validation/schemas.js
const { z } = require('zod');

const uuid = z.string().uuid();

const createTournament = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  maxTeams: z.number().int().min(2),
  totalSessions: z.number().int().min(1),
  sessionType: z.string().min(1),
  leagueId: uuid,
  scheduleType: z.enum(['paired', 'open']).default('paired'),
  rankingMethod: z.enum(['points', 'pins']).default('points'),
  hdcpBase: z.number().int().min(0).optional(),
  hdcpPercentage: z.number().min(0).max(1).optional(),
  season: z.string().optional(),
  year: z.number().int().optional(),
  gamesPerSession: z.number().int().min(1).optional(),
});

const updateTournament = createTournament.partial();

const createPlayer = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  handicap: z.number().int().min(0).max(300).optional(),
});

const updatePlayer = createPlayer.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided' }
);

const createTeam = z.object({
  name: z.string().min(1),
  captainName: z.string().min(1),
  captainEmail: z.string().email(),
  teamType: z.enum(['standard', 'solo']).default('standard'),
});

const updateTeam = z.object({
  name: z.string().min(1).optional(),
  captainName: z.string().min(1).optional(),
  captainEmail: z.string().email().optional(),
  status: z.enum(['active', 'inactive', 'withdrawn']).optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided' }
);

const createLeague = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  maxTeams: z.number().int().min(2).optional(),
  seasonStartDate: z.string().optional(),
  seasonEndDate: z.string().optional(),
});

const submitScore = z.object({
  playerId: uuid,
  teamId: uuid.optional(),
  scores: z.array(z.number().int().min(0).max(300)).min(1),
});

module.exports = {
  createTournament, updateTournament,
  createPlayer, updatePlayer,
  createTeam, updateTeam,
  createLeague,
  submitScore,
};
```

- [ ] **Step 5: Implement validate middleware**

```javascript
// validation/validate.js
const { fail } = require('../utils/response');

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return fail(res, 400, 'VALIDATION_ERROR', 'Invalid input', details);
  }
  req.body = result.data;
  next();
};

module.exports = validate;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/validation.test.js --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 7: Wire validation into routes**

Add `validate(schema)` middleware to route definitions and remove inline validation from controllers:

- `routes/tournaments.js`: `validate(createTournament)` on POST, `validate(updateTournament)` on PUT
- `routes/players.js`: `validate(createPlayer)` on POST, `validate(updatePlayer)` on PUT
- `routes/teams.js`: `validate(createTeam)` on POST, `validate(updateTeam)` on PUT
- `routes/leagues.js`: `validate(createLeague)` on POST
- `routes/scoring.js`: `validate(submitScore)` on POST

Remove the inline `if (!name || ...)` validation blocks from each controller since zod handles it.

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests PASS. Some tests that send invalid data may need assertion updates for the new error shape.

- [ ] **Step 9: Commit**

```bash
git add validation/ tests/validation.test.js routes/ controllers/ package.json package-lock.json
git commit -m "feat: add zod input validation schemas and middleware

Centralizes request body validation with zod schemas for tournament,
player, team, league, and score endpoints. validate() middleware strips
unknown fields and returns structured validation errors."
```

---

### Task 7: Add Pagination to List Endpoints (C5)

**Files:**
- Create: `utils/pagination.js`
- Create: `tests/pagination.test.js`
- Modify: `controllers/tournamentController.js`
- Modify: `controllers/playerController.js`
- Modify: `controllers/teamController.js`
- Modify: `controllers/leagueController.js`

**Interfaces:**
- Produces: `parsePagination(req)` — extracts `page` and `pageSize` from query params with defaults
- Produces: `paginateQuery(baseQuery, params, pagination)` — appends `LIMIT/OFFSET` and runs count query
- Consumes: `paginated()` from `utils/response.js` (Task 1), mappers from Task 2

- [ ] **Step 1: Write failing tests for pagination helpers**

```javascript
// tests/pagination.test.js
const { describe, it, expect } = require('vitest');

describe('pagination helpers', () => {
  let pagination;

  beforeAll(() => {
    pagination = require('../utils/pagination');
  });

  describe('parsePagination', () => {
    it('returns defaults when no query params', () => {
      const result = pagination.parsePagination({ query: {} });
      expect(result).toEqual({ page: 1, pageSize: 20 });
    });

    it('parses page and pageSize from query', () => {
      const result = pagination.parsePagination({ query: { page: '3', pageSize: '50' } });
      expect(result).toEqual({ page: 3, pageSize: 50 });
    });

    it('clamps pageSize to max 100', () => {
      const result = pagination.parsePagination({ query: { pageSize: '500' } });
      expect(result.pageSize).toBe(100);
    });

    it('floors page to 1', () => {
      const result = pagination.parsePagination({ query: { page: '0' } });
      expect(result.page).toBe(1);
    });

    it('handles NaN gracefully', () => {
      const result = pagination.parsePagination({ query: { page: 'abc' } });
      expect(result.page).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pagination.test.js --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement pagination helpers**

```javascript
// utils/pagination.js
const { query } = require('../config/database');

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const parsePagination = (req) => {
  let page = parseInt(req.query.page, 10);
  let pageSize = parseInt(req.query.pageSize, 10);

  if (isNaN(page) || page < 1) page = DEFAULT_PAGE;
  if (isNaN(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

  return { page, pageSize };
};

const paginateQuery = async (baseQuery, params, { page, pageSize }) => {
  const offset = (page - 1) * pageSize;

  const countQuery = `SELECT COUNT(*) FROM (${baseQuery}) AS _count`;
  const countResult = await query(countQuery, params);
  const total = parseInt(countResult.rows[0].count, 10);

  const dataQuery = `${baseQuery} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const dataResult = await query(dataQuery, [...params, pageSize, offset]);

  return { rows: dataResult.rows, total, page, pageSize };
};

module.exports = { parsePagination, paginateQuery };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pagination.test.js --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 5: Apply pagination to list endpoints**

Update `getAllTournaments`, `getAllPlayers`, `getAllTeams`, `getAllLeagues`:

```javascript
const { parsePagination, paginateQuery } = require('../utils/pagination');
const { paginated } = require('../utils/response');
const { toTournamentListResponse } = require('../mappers/tournament');

const getAllTournaments = async (req, res) => {
  try {
    const pg = parsePagination(req);
    const baseQuery = 'SELECT * FROM tournaments ORDER BY created_at DESC';
    const result = await paginateQuery(baseQuery, [], pg);
    paginated(res, toTournamentListResponse(result.rows), {
      page: result.page, pageSize: result.pageSize, total: result.total
    });
  } catch (error) {
    logger.error('Error fetching tournaments:', error);
    fail(res, 500, 'INTERNAL_ERROR', 'Failed to fetch tournaments');
  }
};
```

Same pattern for players, teams, leagues with their respective mappers.

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: Tests that check list responses need updating — now receive `{ data: [...], pagination: { ... } }` instead of `{ data: [...] }`.

- [ ] **Step 7: Commit**

```bash
git add utils/pagination.js tests/pagination.test.js controllers/
git commit -m "feat: add offset-based pagination to list endpoints

Introduces parsePagination() and paginateQuery() helpers. Applied to
GET /tournaments, /players, /teams, /leagues. Default page size 20,
max 100. Response: { data: [], pagination: { page, pageSize, total, totalPages } }."
```

---

### Task 8: Update OpenAPI Spec (C9)

**Files:**
- Modify: `bowling_api_oas.yaml`

**Interfaces:**
- Consumes: All changes from Tasks 1-7

**Context:**
The OAS was updated by the background agent to reflect the target state (Phase 1 envelope format). Verify it matches the actual implementation after all tasks are complete. The spec should already be mostly correct — this task is a final reconciliation pass.

- [ ] **Step 1: Verify OAS matches implementation**

Spot-check a few endpoints:
- Does a tournament POST 201 response match `toTournamentResponse` output wrapped in `{ data }`?
- Do error responses match `{ error: { code, message } }`?
- Do list endpoints show pagination parameters and `{ data, pagination }` response?
- Is `POST /schedule/validate` (not GET)?
- Are 409 status codes documented for conflict scenarios?

- [ ] **Step 2: Fix any discrepancies**

Update `bowling_api_oas.yaml` for any mismatches found in Step 1.

- [ ] **Step 3: Validate the spec**

```bash
npx @redocly/cli@latest lint bowling_api_oas.yaml
```

Fix any linting errors.

- [ ] **Step 4: Commit**

```bash
git add bowling_api_oas.yaml
git commit -m "docs: reconcile OpenAPI spec with Phase 1 implementation

Verified response schemas match mapper output, error format, pagination,
POST /schedule/validate, and 409 status codes."
```

---

## API Versioning (C8) — Deferred

API versioning is deliberately excluded. The frontend (bowling-tournament-app) is the only consumer and is under your control. Revisit when/if the API has third-party consumers.

---

## Task Dependency Graph

```
Task 1 (response helpers + errorHandler)
  ├── Task 2 (mapper layer) — independent of Task 1 but logically paired
  │
  └── Task 3 (wire mappers + remove outputFormatter) — after Tasks 1 and 2
        ├── Task 4 (HTTP status codes 409) — after Task 3
        ├── Task 5 (GET→POST validate) — independent, can run anytime
        ├── Task 6 (zod validation) — after Task 1 (uses fail())
        └── Task 7 (pagination) — after Tasks 1, 2, 3
              └── Task 8 (OAS reconciliation) — last, after all others
```

Tasks 1 and 2 can be parallelized. Task 3 depends on both. Tasks 4, 5, 6 can run after Task 3. Task 7 after Task 3. Task 8 is always last.
