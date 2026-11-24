# Access Control Model (RBAC)

## Overview

Three-tier role hierarchy scoped to different levels of the system. A single user can hold different roles across leagues and teams.

---

## Role Hierarchy

### 1. Superadmin (System-level)

The system operator. Bootstrapped outside the app (Auth0 role or seed script).

**Responsibilities:**
- Create and manage leagues
- Assign league admins
- Manage global player eligibility (ban/suspend across all leagues)
- Full read/write access to everything

**Scope:** Global -- not tied to any league or team.

### 2. League Admin (League-level)

Manages a specific league. A league can have multiple admins. A league admin can also be a player in that league.

**Responsibilities:**
- Create tournaments within their league
- Configure tournament settings (sessions, ranking method, handicap)
- Approve/reject team registrations into tournaments
- Generate and manage schedules
- Oversee and correct scores (edit/delete any score in their league)
- Finalize sessions and tournaments
- Manage player eligibility within their league (suspend/ban)
- Resolve violations (double-team, ineligible player)

**Scope:** One or more specific leagues. No access to administer other leagues.

### 3. Team Roles (Tournament-Team-level)

Stored in `team_players.role`. Scoped per tournament -- a player's role can differ across tournaments.

#### Captain
- Register/remove players on their team roster
- Submit and edit scores for any player on their team
- View all team and league data

#### Regular
- Submit their own scores
- View their team's data and league standings
- Cannot modify other players' scores or roster

#### Substitute
- Submit their own scores (when active for a session)
- View their team's data and league standings (read-only)
- Cannot modify roster or other players' scores

---

## Permission Matrix

| Action | Superadmin | League Admin | Captain | Regular | Substitute |
|---|---|---|---|---|---|
| Create league | Yes | -- | -- | -- | -- |
| Assign league admin | Yes | -- | -- | -- | -- |
| Create tournament | Yes | Own league | -- | -- | -- |
| Configure tournament | Yes | Own league | -- | -- | -- |
| Register team to tournament | Yes | Own league | Own team | -- | -- |
| Approve team registration | Yes | Own league | -- | -- | -- |
| Generate schedule | Yes | Own league | -- | -- | -- |
| Add/remove players on roster | Yes | Own league | Own team | -- | -- |
| Submit own scores | Yes | Yes | Yes | Yes | Yes |
| Submit team scores | Yes | Own league | Own team | -- | -- |
| Edit/delete any score | Yes | Own league | Own team | -- | -- |
| **View** league standings / leaderboards | Public | Public | Public | Public | Public |
| **View** tournament scores & match results | Public | Public | Public | Public | Public |
| **View** player profile (name, average, history) | Yes | Same league | Same league | Same league | Same league |
| **View** player contact info (email, phone) | Yes | Own league | Own team | Self only | Self only |
| View team data | Yes | Yes | Own team | Own team | Own team |
| Manage player eligibility | Yes (global) | Own league | -- | -- | -- |
| Resolve violations | Yes | Own league | -- | -- | -- |
| Finalize session/tournament | Yes | Own league | -- | -- | -- |

---

## Implementation Approach

### Where roles live

| Role | Storage | Reasoning |
|---|---|---|
| Superadmin | Auth0 JWT claim (`roles: ["superadmin"]`) | System-level, managed entirely in the IdP. No DB lookup needed. |
| League Admin | Auth0 JWT claim (`roles: ["league_admin"]`) + DB `league_admins` table `(player_id, league_id, assigned_at, assigned_by)` | Role type from IdP, league scope from DB. Keeps role management in Auth0, assignment in our domain. |
| Captain / Regular / Substitute | Existing `team_players.role` column | Already in place. Scoped per tournament-team. |

### Middleware chain

```
jwtCheck → requirePlayer → resolveRoles → authorize(permission)
```

1. **jwtCheck** -- validates Auth0 JWT (exists, currently disabled)
2. **requirePlayer** -- lazy-provisions player from JWT claims (exists)
3. **resolveRoles** (new) -- attaches roles to `req.player`:
   - `req.player.isSuperadmin` from JWT claim
   - `req.player.leagueRoles` from `league_roles` table (loaded when league context present)
   - `req.player.teamRole` from `team_players` (loaded when team context present)
4. **authorize(permission)** (new) -- checks if resolved roles satisfy the required permission for the endpoint. Returns 403 if not.

### Key constraint

> A player cannot be on two different teams in the same league.

Already enforced by a DB trigger on `team_players`. No changes needed.

---

## Account Bootstrapping

**First superadmin:** Provisioned manually -- either via Auth0 dashboard (assign role) or a one-time seed script.

**League admins:** Appointed by a superadmin via `POST /api/leagues/:leagueId/admins`.

**Players:** Self-service via Auth0 signup. Lazy-provisioned on first API call. No role until added to a team roster.

**Captains:** Assigned when a team is created or when a league admin registers a team into a tournament and designates the captain.
