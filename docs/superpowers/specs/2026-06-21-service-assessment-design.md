# Bowling Tourney Service — Assessment & Remediation Plan

**Date:** 2026-06-21
**Scope:** Full API assessment — design, completeness, operational readiness
**Priority order:** API Design (C) > Feature Completeness (B) > Operational Readiness (A)

---

## Current State Summary

Express 4 + PostgreSQL API managing bowling tournament leagues. Supports paired (head-to-head, points-based) and open (individual, pins-based) tournament formats. 17 migrations applied. Unified scoring model. RLS policies defined but not yet enforced (Auth0 integration deferred to Phase 4). Test suite covers core happy paths.

---

## Track C — API Design Quality

### Strengths

- Unified scoring endpoint handles both formats via single path
- Session-scoped score routes are well-structured
- Parameterized queries throughout — no SQL injection
- camelCase output formatter exists

### Issues

| ID | Issue | Detail |
|----|-------|--------|
| C1 | Inconsistent response shapes | Some endpoints return raw DB rows, others manually construct objects, some use `toCamelCase()`. Frontend has to guess the shape. |
| C2 | `outputFormatter` not global | Only applied to tournament-prefixed routes. Other routes return snake_case. |
| C3 | Wrong HTTP status codes | Duplicate registrations return 400 (should be 409). Schedule preview returns 200 for creation. |
| C4 | `GET /schedule/validate` should be POST | Runs validation queries — not idempotent in spirit. |
| C5 | No pagination | All list endpoints return unbounded results. |
| C6 | No input validation library | All validation is ad-hoc inline. Inconsistent coverage. |
| C7 | Inconsistent error format | Sometimes `{ error }`, sometimes `{ message }`, sometimes bare. |
| C8 | No API versioning | Breaking changes have no safety net. |
| C9 | Swagger docs may be stale | May not reflect unified scoring or domain simplification changes. |

### Done Criteria

- Consistent response envelope across all endpoints
- Global camelCase transformation
- Proper HTTP status codes (409 for conflicts, 201 for creations)
- Standardized error format: `{ error: { code, message } }`
- Pagination on all list endpoints (cursor or offset-based)
- Input validation via zod or joi at route level
- Swagger docs reflect current API

---

## Track B — Feature Completeness

### What Works Today

- League and tournament CRUD
- Team/player registration with duplicate prevention
- Round-robin schedule generation (paired format)
- Score submission (open and paired)
- Handicap calculation and carry-forward via DB triggers
- Standings (points-based via view, pins-based via aggregation)

### Gaps

| ID | Gap | Impact |
|----|-----|--------|
| B1 | No session lifecycle state machine | Sessions can jump to any status. No validation that scores are complete before marking `completed`. No auto-completion. |
| B2 | No match finalization / score locking | Scores can be edited after a match is `completed`. Results are never "official". |
| B3 | No season rollover | `season` and `year` fields exist but no workflow to close a season, archive standings, or carry handicaps forward. |
| B4 | No bracket/playoff scheduling | Only round-robin exists. No elimination brackets, no playoff generation from standings. |
| B5 | `generateRoundRobinSchedule` ignores `totalSessions` | Produces N-1 rounds only (one per unique pairing). Can't repeat rotations to fill configured session count. |
| B6 | No bye team handling for standings | Odd-team round-robin creates byes but no mechanism to award points/pins for bye weeks. Teams on bye are penalized in standings. Options: average-based credit, fixed point award, or accept natural balancing over full rotation. Needs configurable policy. |
| B7 | No score audit trail | No history of changes. Paired format hard-deletes, open format soft-deletes. Can't resolve disputes. |
| B8 | Player eligibility not enforced | `player_league_eligibility` table exists but isn't checked during score submission or registration. |

### Done Criteria

- Session status transitions enforced (scheduled -> active -> completed)
- Completion requires all scores submitted
- Matches lock after finalization; unlock requires explicit action
- Round-robin respects `totalSessions` configuration
- Bye policy configurable per tournament
- Score changes tracked with audit records
- Eligibility checked at registration and score submission

---

## Track A — Operational Readiness

### What's Solid

- Parameterized queries — no SQL injection
- DB triggers handle handicap recalculation atomically
- Connection pooling configured
- Graceful shutdown hook
- Test suite covers core happy paths

### Issues

| ID | Issue | Severity | Detail |
|----|-------|----------|--------|
| A1 | SQL parameter bug in `teamController.js:116` | P0 | `WHERE id = ${paramCounter}` — missing `$` prefix. UPDATE fails or uses wrong parameter. |
| A2 | `async forEach` in `scheduleController.js:407,428` | P0 | `await` inside `.forEach()` doesn't wait. Validation queries fire-and-forget. Results always show "valid" even when conflicts exist. |
| A3 | `errorHandler.js` crashes on undefined `err.status` | P0 | Most thrown errors don't set `.status`. Handler itself fails, Express falls back to default. |
| A4 | Score deletion inconsistency | P1 | Paired hard-deletes, open soft-deletes. No audit trail for either. |
| A5 | `statisticsController` hardcodes `* 3` | P1 | Should use `games_per_session` from tournament. Wrong if games_per_session != 3. |
| A6 | Mixed logging | P2 | `console.error`/`console.log` mixed with Pino `logger` across controllers. |
| A7 | No rate limiting | P2 | All endpoints open to abuse. |
| A8 | Pool error handler exits process | P2 | No graceful degradation on transient DB errors. |
| A9 | `@auth0/nextjs-auth0` in dependencies | P2 | Wrong package for a backend service. Unused. |
| A10 | No linting or formatting | P2 | No eslint/prettier configured. |
| A11 | Test coverage gaps | P2 | No tests for playerController, teamController, middleware, error paths. |

### Done Criteria

- P0 bugs fixed
- Consistent error handling with proper status codes and logging
- Score deletion strategy unified with audit trail
- Stats calculations use tournament config, not hardcoded values
- Pino logger used everywhere
- Test coverage on error paths and edge cases

---

## Remediation Plan

### Phase 1 — API Design Hardening (Track C)

1. Standardize error response format across all controllers
2. Apply `outputFormatter` globally or refactor to middleware
3. Fix HTTP status codes (409 for conflicts, 201 for creations)
4. Add zod/joi validation schemas for all endpoints
5. Add pagination to list endpoints
6. Update Swagger docs to match current API

### Phase 2 — Fix P0 Bugs (Track A, partial)

1. Fix `teamController.js:116` SQL parameter bug
2. Replace `async forEach` with `for...of` in `scheduleController.js`
3. Fix `errorHandler.js` to handle undefined `err.status`

### Phase 3 — Core Feature Gaps (Track B, partial)

1. Session state machine (enforce valid transitions, auto-complete)
2. Match finalization and score locking
3. Fix `generateRoundRobinSchedule` to respect `totalSessions`
4. Score audit trail (unified soft-delete + change history)

### Phase 4 — Auth & RLS Activation (existing plan)

1. Re-enable JWT middleware
2. Wire `withTeamContext` into controllers for team-scoped writes
3. Add input validation at auth boundary

### Phase 5 — Remaining Gaps

1. Bye team policy (configurable per tournament)
2. Player eligibility enforcement
3. Season rollover workflow
4. Bracket/playoff scheduling

### Phase 6 — Operational Polish (Track A, remaining)

1. Unify logging to Pino
2. Fix `statisticsController` hardcoded `* 3`
3. Remove unused `@auth0/nextjs-auth0` dependency
4. Add eslint/prettier
5. Rate limiting
6. Expand test coverage (error paths, middleware, edge cases)
