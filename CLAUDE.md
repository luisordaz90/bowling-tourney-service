# CLAUDE.md — bowling-tourney-service

## Overview
Bowling tournament management REST API.
Stack: Node.js · Express 4 · PostgreSQL (pg pool + AsyncLocalStorage) · Pino logger · Auth0 JWT · Vitest

## Commands
- `npm run dev` — start with nodemon (port 3000)
- `npm test` — run Vitest test suite
- `npm run db:migrate` — apply pending SQL migrations from `db/migrations/`
- `npm run db:setup-user` — create the low-privilege `bowling_app` PostgreSQL role

## Local Setup
- Copy `.env.example` to `.env.local` and fill in secrets
- `SKIP_AUTH=true` bypasses JWT validation locally
- Requires PostgreSQL running (Docker via `compose.yaml` or native)

## Architecture

### API Routes
- **Nested routes** (legacy): `/api/leagues/:leagueId/tournaments/:tournamentId/...`
- **Flat routes** (preferred): `/api/registrations`, `/api/scores`, `/api/matches`, `/api/sessions`
- New endpoints should use flat routes

### RBAC
- `resolveRoles` middleware resolves user roles from DB (super_admin, league_admin, team_captain, player)
- `authorize(roles[])` middleware gates access
- Team-scoped queries use `requireTeamContext` with RLS via `bowling_app` role

### Database
- Migrations are sequential SQL files in `db/migrations/` (001–028+)
- Use `query()` from `config/database.js` for simple queries
- Use AsyncLocalStorage client for transaction/RLS-scoped work
- Player lookup cached in-memory (5min TTL) in `requirePlayer`

### Scoring Domain
- Handicap formula: `FLOOR((base - avg) * percentage)`, clamped to `[floor, cap]`
- `scoring_config` JSONB on tournaments table holds point rules, bonus categories, handicap settings
- `recalculateSessionHandicaps` runs on session completion, wrapped in SAVEPOINT
- Match points are frozen once calculated — no retroactive recalculation

### Testing
- Vitest with test DB (same schema, separate data)
- Tests create their own fixtures; no shared mutable state
- Run specific file: `npx vitest run tests/scores-matches-flat.test.js`

## Conventions
- Controllers export named functions, one per route handler
- camelCase in JS, snake_case in SQL — `toCamelCase()` utility converts DB rows
- Error responses: `{ error: "message" }` with appropriate HTTP status

## PR Rules
- **Before starting feature work, ask the user for a branch name**
- **A single PR must not contain more than 10 committed files** — split into smaller PRs if needed
- Always present a plan and wait for approval before coding
- Include tests as part of any feature plan
