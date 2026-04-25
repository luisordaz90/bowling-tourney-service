# E2E Test Plan — Full Tournament Lifecycle

## Overview

One test file (`tests/e2e-tournament-lifecycle.test.js`) that walks through the complete lifecycle of two bowling leagues running concurrently: one **paired** league (head-to-head with points) and one **open** league (individual pin carry with handicap). Each league has its own tournament. The same teams and players participate in both, and both run a full season.

The test simulates realistic bowling: 4 teams of 3 players each, varying scores per player, weekly sessions, match completion with point calculation, handicap recalculation, and finally validates all statistics and standings at the end.

---

## Fixture Data

### Leagues (2)
| League | Type |
|--------|------|
| Metro Paired League | standard |
| Metro Open League | standard |

### Editions (1 per league)
| League | Edition | Season | Year | Start | End |
|--------|---------|--------|------|-------|-----|
| Metro Paired League | Spring 2026 | spring | 2026 | 2026-04-01 | 2026-06-30 |
| Metro Open League | Spring 2026 | spring | 2026 | 2026-04-01 | 2026-06-30 |

### Teams (4)
| Team | Captain | Type |
|------|---------|------|
| Rolling Thunder | Alice | standard |
| Pin Crushers | Bob | standard |
| Gutter Guards | Carol | standard |
| Strike Force | Dave | standard |

### Players (12 — 3 per team)
| Team | Player | Skill Level (approx avg) |
|------|--------|--------------------------|
| Rolling Thunder | Alice | 190 |
| Rolling Thunder | Andy | 170 |
| Rolling Thunder | Amy | 160 |
| Pin Crushers | Bob | 200 |
| Pin Crushers | Beth | 185 |
| Pin Crushers | Ben | 175 |
| Gutter Guards | Carol | 180 |
| Gutter Guards | Chris | 165 |
| Gutter Guards | Chloe | 155 |
| Strike Force | Dave | 210 |
| Strike Force | Diana | 195 |
| Strike Force | Dan | 170 |

### Tournaments (1 per league)
| Tournament | League | Schedule Type | Ranking Method | Hdcp Base | Hdcp % |
|------------|--------|--------------|----------------|-----------|--------|
| Metro Paired Spring 2026 | Metro Paired League | paired | points | 220 | 0.90 |
| Metro Open Spring 2026 | Metro Open League | open | pins | 220 | 0.90 |

---

## Test Structure

```
describe('E2E: Full Tournament Lifecycle')
  Phase 1 — League & Edition Setup
  Phase 2 — Team & Player Creation
  Phase 3 — Tournament Creation & Registration
  Phase 4 — Schedule Generation (Paired)
  Phase 5 — Session Creation (Open)
  Phase 6 — Score Submission (Weeks 1–3, both tournaments)
  Phase 7 — Mid-Season Statistics Validation
  Phase 8 — Score Update & Delete
  Phase 9 — Remaining Weeks (4–6)
  Phase 10 — Final Statistics & Standings
```

---

## Phase 1 — League & Edition Setup

### 1.1 Create paired league
```
POST /api/leagues
Body: { name: "Metro Paired League", leagueType: "standard" }
Assert: 201, body.id exists
```

### 1.2 Create open league
```
POST /api/leagues
Body: { name: "Metro Open League", leagueType: "standard" }
Assert: 201, body.id exists
```

### 1.3 Create edition for paired league
```
POST /api/leagues/:pairedLeagueId/editions
Body: {
  name: "Spring 2026", season: "spring", year: 2026,
  startDate: "2026-04-01", endDate: "2026-06-30",
  totalSessions: 10, sessionType: "weekly"
}
Assert: 201, body.editionNumber === 1
```

### 1.4 Create edition for open league
```
POST /api/leagues/:openLeagueId/editions
Body: {
  name: "Spring 2026", season: "spring", year: 2026,
  startDate: "2026-04-01", endDate: "2026-06-30",
  totalSessions: 10, sessionType: "weekly"
}
Assert: 201, body.editionNumber === 1
```

### 1.5 Verify league retrieval
```
GET /api/leagues/:pairedLeagueId
Assert: 200, body.name === "Metro Paired League"

GET /api/leagues/:pairedLeagueId/editions
Assert: 200, array length === 1

GET /api/leagues/:openLeagueId
Assert: 200, body.name === "Metro Open League"

GET /api/leagues/:openLeagueId/editions
Assert: 200, array length === 1
```

---

## Phase 2 — Team & Player Creation

### 2.1 Create 4 teams
```
POST /api/teams (x4)
Assert: 201 for each, store team IDs
```

### 2.2 Create 12 players
```
POST /api/players (x12)
Assert: 201 for each, store player IDs
```

### 2.3 Verify listing
```
GET /api/teams
Assert: response includes all 4 teams

GET /api/players
Assert: response includes all 12 players
```

---

## Phase 3 — Tournament Creation & Registration

### 3.1 Create paired tournament (under paired league)
```
POST /api/tournaments
Body: {
  name: "Metro Paired Spring 2026",
  startDate: "2026-04-01", endDate: "2026-06-30",
  maxTeams: 8, totalSessions: 10, sessionType: "weekly",
  leagueId: pairedLeagueId, editionId: pairedEditionId,
  scheduleType: "paired", rankingMethod: "points",
  hdcpBase: 220, hdcpPercentage: 0.90
}
Assert: 201, body.scheduleType === "paired"
```

### 3.2 Create open tournament (under open league)
```
POST /api/tournaments
Body: {
  name: "Metro Open Spring 2026",
  startDate: "2026-04-01", endDate: "2026-06-30",
  maxTeams: 8, totalSessions: 10, sessionType: "weekly",
  leagueId: openLeagueId, editionId: openEditionId,
  scheduleType: "open", rankingMethod: "pins",
  hdcpBase: 220, hdcpPercentage: 0.90
}
Assert: 201, body.scheduleType === "open"
```

### 3.3 Register all 4 teams to both tournaments
```
POST /api/tournaments/:pairedId/teams (x4)
POST /api/tournaments/:openId/teams (x4)
Assert: 201 for each, no duplicates
```

### 3.4 Register players to their teams (both tournaments)
```
POST /api/tournaments/:pairedId/teams/:teamId/players (x12)
POST /api/tournaments/:openId/teams/:teamId/players (x12)
Assert: 201 for each
```

### 3.5 Verify rosters
```
GET /api/tournaments/:pairedId/teams
Assert: 4 teams registered

GET /api/tournaments/:pairedId/teams/:teamId/players (for each team)
Assert: 3 players per team
```

### 3.6 Validate player assignment (league rule enforcement)

Attempting to assign Alice to Pin Crushers in the paired league should fail — she's already on Rolling Thunder in that league:
```
POST /api/leagues/validate-assignment
Body: { playerId: alice, teamId: pinCrushers, tournamentId: pairedTournamentId }
Assert: 200, isValid === false, violations includes "multiple_teams_in_league"
```

Assigning Alice to Rolling Thunder in the open league should succeed — different league:
```
POST /api/leagues/validate-assignment
Body: { playerId: alice, teamId: rollingThunder, tournamentId: openTournamentId }
Assert: 200, isValid === true, violations.length === 0
```

---

## Phase 4 — Schedule Generation (Paired Tournament)

### 4.1 Preview round-robin
```
GET /api/tournaments/:pairedId/schedule/round-robin/preview
Assert: 200
  - totalTeams === 4
  - sessionsRequired === 3 (N-1 for 4 teams)
  - totalMatches === 6 (4*3/2)
  - matchesPerSession === 2
  - isValidSchedule === true
  - schedule array has 3 entries
  - each session has 2 matches
  - no team plays twice in same session
```

### 4.2 Generate round-robin schedule
```
POST /api/tournaments/:pairedId/schedule/round-robin
Body: { startDate: "2026-04-07", daysBetweenSessions: 7 }
Assert: 201
  - totalMatchesCreated === 6
  - totalSessionsCreated === 3
  - createdSessions has dates 7 days apart (04-07, 04-14, 04-21)
  - each match has status "scheduled"
```

### 4.3 Verify schedule integrity
```
GET /api/tournaments/:pairedId/schedule/summary
Assert: 200
  - isCompleteRoundRobin === true
  - hasScheduleConflicts === false
  - matchStats.total === 6
  - matchStats.scheduled === 6

GET /api/tournaments/:pairedId/schedule/validate
Assert: 200, isValid === true, issues.length === 0
```

### 4.4 Fetch sessions and matches
```
GET /api/tournaments/:pairedId/sessions
Assert: 3 sessions, ordered by sessionNumber

GET /api/tournaments/:pairedId/sessions/1/matches
Assert: 2 matches, each with homeTeamDetails and awayTeamDetails

GET /api/tournaments/:pairedId/matches
Assert: 6 total matches across all sessions
```

---

## Phase 5 — Session Creation (Open Tournament)

Open tournaments don't use round-robin. Sessions are created manually.

### 5.1 Create sessions 1–3 for open tournament
```
POST /api/tournaments/:openId/sessions (x3)
Body: { sessionNumber: N, sessionName: "Week N", sessionDate: "2026-04-0X" }
Assert: 201 for each
```

### 5.2 Verify sessions
```
GET /api/tournaments/:openId/sessions
Assert: 3 sessions, ordered by sessionNumber
```

---

## Phase 6 — Score Submission (Weeks 1–3)

Score data uses the player skill levels from the fixture table with some variance to make the simulation realistic. Each player bowls 3 games per session.

### Score Helper
```js
// Generate realistic scores around a player's average
function generateScores(average, variance = 20) {
  return [
    average + Math.floor(Math.random() * variance * 2 - variance),
    average + Math.floor(Math.random() * variance * 2 - variance),
    average + Math.floor(Math.random() * variance * 2 - variance)
  ].map(s => Math.max(0, Math.min(300, s)));
}
```

Use deterministic seed scores for predictable assertions. Example week 1 scores:

| Player | Avg | Week 1 Scores |
|--------|-----|---------------|
| Alice | 190 | [185, 195, 190] |
| Andy | 170 | [165, 175, 170] |
| Amy | 160 | [155, 165, 160] |
| Bob | 200 | [195, 205, 200] |
| Beth | 185 | [180, 190, 185] |
| Ben | 175 | [170, 180, 175] |
| Carol | 180 | [175, 185, 180] |
| Chris | 165 | [160, 170, 165] |
| Chloe | 155 | [150, 160, 155] |
| Dave | 210 | [205, 215, 210] |
| Diana | 195 | [190, 200, 195] |
| Dan | 170 | [165, 175, 170] |

### 6.1 Submit scores — paired tournament, session 1

For each match in session 1 (2 matches, 4 teams):

```
POST /api/tournaments/:pairedId/sessions/1/scores
Body: { playerId, teamId, scores: [g1, g2, g3] }
Assert: 201
  - matchId is NOT null (paired format resolves match)
  - scores array matches input
  - handicapApplied === 0 (first session)
```

Submit all 3 players per team (6 requests per match = 12 total for session 1).

### 6.2 Calculate team scores & trigger match completion

For each match in session 1:

```
POST /api/matches/:matchId/team-scores/calculate
Body: { teamId: homeTeamId }
Assert: 201, totalTeamScore > 0

POST /api/matches/:matchId/team-scores/calculate
Body: { teamId: awayTeamId }
Assert: 201, matchCompleted === true
```

### 6.3 Verify match completion
```
GET /api/matches/:matchId
Assert: status === "completed", winnerTeamName is not null
```

### 6.4 Verify match points
```
GET /api/matches/:matchId/team-scores
Assert: 2 entries (home + away), each with totalTeamScore

GET /api/matches/:matchId/player-scores
Assert: 6 entries (3 per team)
```

### 6.5 Submit scores — open tournament, session 1

For each of the 12 players (using solo team IDs):

```
POST /api/tournaments/:openId/sessions/1/scores
Body: { playerId, teamId, scores: [g1, g2, g3] }
Assert: 201
  - matchId === null (open format)
  - handicapApplied === 0 (first session)
  - totalPins === sum of scores (no handicap yet)
  - sessionAverage === totalPins / 3
```

### 6.6 Verify handicap recalculation after session 1 (open)
```
GET /api/tournaments/:openId/players/:playerId/statistics
Assert:
  - currentHandicap === FLOOR((220 - playerAverage) * 0.90)
  - For Alice (avg 190): FLOOR((220-190)*0.90) = FLOOR(27) = 27
  - For Dave (avg 210): FLOOR((220-210)*0.90) = FLOOR(9) = 9
```

### 6.7 Retrieve session scores (open)
```
GET /api/tournaments/:openId/sessions/1/scores
Assert: 200
  - 12 entries, ordered by totalPins DESC
  - each has playerName, teamName, scores array, sessionAverage
```

### 6.8 Submit scores — paired tournament, sessions 2 & 3

Repeat 6.1–6.4 for sessions 2 and 3. All 6 matches should now be completed.

### 6.9 Submit scores — open tournament, sessions 2 & 3

Repeat 6.5 for sessions 2 and 3.

### 6.10 Verify handicap applied in session 2+ (open)
```
POST /api/tournaments/:openId/sessions/2/scores (for Alice)
Assert: 201
  - handicapApplied === 27 (Alice's hdcp from session 1)
  - totalPins === rawPins + (27 * 3)
```

### 6.11 Duplicate score rejection
```
POST /api/tournaments/:pairedId/sessions/1/scores
Body: { playerId: alice, teamId: rollingThunder, scores: [180, 180, 180] }
Assert: 400, error matches /already recorded/i
```

### 6.12 Invalid score rejection
```
POST /api/tournaments/:openId/sessions/1/scores
Body: { playerId: (unused player), teamId, scores: [301, 200, 200] }
Assert: 400, error matches /between 0 and 300/i
```

### 6.13 Session not found
```
POST /api/tournaments/:pairedId/sessions/99/scores
Body: { playerId, teamId, scores: [180, 180, 180] }
Assert: 404, error matches /session not found/i
```

---

## Phase 7 — Mid-Season Statistics Validation (After 3 Weeks)

### 7.1 Paired tournament standings
```
GET /api/tournaments/:pairedId/standings
Assert: 200
  - Array of 4 teams
  - Ordered by rank (1–4)
  - Each has: totalPoints, matchesPlayed (3), matchesWon, matchesLost
  - totalPoints sum across all teams === 6 * 4 = 24 (6 matches, 4 points each)
  - SUM(matchesWon) === SUM(matchesLost) === 6 (one winner per match, ties possible but unlikely with deterministic data)
```

### 7.2 Open tournament standings
```
GET /api/tournaments/:openId/standings
Assert: 200
  - Array of 12 players (individual standings)
  - Ordered by totalPins DESC
  - Each has: totalPins, tournamentAverage, sessionsPlayed (3)
  - Dave should be near the top (highest average)
  - Chloe should be near the bottom (lowest average)
```

### 7.3 Tournament-wide statistics
```
GET /api/tournaments/:pairedId/statistics
Assert: 200
  - totalTeams === 4
  - totalMatches === 6
  - completedMatches === 6
  - totalPlayers >= 12
  - highestGame > 0
```

### 7.4 Individual player statistics
```
GET /api/tournaments/:pairedId/players/:daveId/statistics
Assert: 200
  - gamesPlayed === 9 (3 sessions * 3 games)
  - currentAverage close to 210
  - highestGame > 0
  - matchesPlayed === 3

GET /api/tournaments/:openId/players/:daveId/statistics
Assert: 200
  - currentHandicap === 9 (FLOOR((220-210)*0.90))
```

### 7.5 Team statistics
```
GET /api/tournaments/:pairedId/teams/:strikeForceId/statistics
Assert: 200
  - totalMatchesPlayed === 3
  - matchesWon + matchesLost === 3
  - totalPoints > 0
```

### 7.6 Bulk statistics endpoints
```
GET /api/tournaments/:pairedId/player-statistics
Assert: 200, array of 12 player stat objects

GET /api/tournaments/:pairedId/team-statistics
Assert: 200, array of 4 team stat objects
```

---

## Phase 8 — Score Update & Delete

### 8.1 Update a player's score in paired match
```
PUT /api/tournaments/:pairedId/sessions/1/scores/:aliceId
Body: { teamId: rollingThunderId, scores: [250, 250, 250] }
Assert: 200
  - scores === [250, 250, 250]
  - totalPins reflects new scores
```

### 8.2 Verify match points recomputed
```
GET /api/matches/:session1MatchId
Assert: 200
  - status still "completed"
  - points breakdown may have changed (Alice's team now has much higher scores)
```

### 8.3 Update a player's score in open format
```
PUT /api/tournaments/:openId/sessions/1/scores/:aliceId
Body: { scores: [250, 250, 250] }
Assert: 200
```

### 8.4 Verify handicap recalculated after update (open)
```
GET /api/tournaments/:openId/players/:aliceId/statistics
Assert: currentAverage is higher now, currentHandicap is lower
```

### 8.5 Delete a player's score in paired match
```
DELETE /api/tournaments/:pairedId/sessions/1/scores/:aliceId
Body: { teamId: rollingThunderId }
Assert: 200, message matches /deleted/i
```

### 8.6 Verify match reverted to in_progress
```
GET /api/matches/:session1MatchId
Assert: status === "in_progress", winnerTeamName === null
```

### 8.7 Re-submit deleted score to restore match
```
POST /api/tournaments/:pairedId/sessions/1/scores
Body: { playerId: aliceId, teamId: rollingThunderId, scores: [185, 195, 190] }
Assert: 201
```

### 8.8 Re-calculate team scores to re-complete the match
```
POST /api/matches/:session1MatchId/team-scores/calculate
Body: { teamId: rollingThunderId }

POST /api/matches/:session1MatchId/team-scores/calculate
Body: { teamId: (opponent) }
Assert: matchCompleted === true
```

### 8.9 Delete score — 404 for nonexistent
```
DELETE /api/tournaments/:pairedId/sessions/1/scores/00000000-0000-0000-0000-000000000000
Body: { teamId: rollingThunderId }
Assert: 404
```

### 8.10 Update score — 404 for nonexistent
```
PUT /api/tournaments/:pairedId/sessions/1/scores/00000000-0000-0000-0000-000000000000
Body: { teamId: rollingThunderId, scores: [200, 200, 200] }
Assert: 404
```

### 8.11 Update score — 400 for invalid scores
```
PUT /api/tournaments/:pairedId/sessions/1/scores/:aliceId
Body: { teamId: rollingThunderId, scores: [301, 200, 200] }
Assert: 400
```

---

## Phase 9 — Remaining Weeks (4–6)

### 9.1 Create sessions 4–6 for open tournament
```
POST /api/tournaments/:openId/sessions (x3)
Assert: 201 for each
```

### 9.2 Generate additional round-robin sessions for paired

Since 4 teams only need 3 sessions for a full round-robin, sessions 4–6 would be a second round. Two options:

**Option A**: Delete the existing schedule and regenerate with new session dates.

```
DELETE /api/tournaments/:pairedId/schedule
Assert: fails (400) because matches have scores — confirming the guard works
```

**Option B**: Manually create sessions 4–6 and matches for the second round-robin pass. This tests manual match creation:

```
POST /api/tournaments/:pairedId/sessions (x3, sessions 4–6)
POST /api/tournaments/:pairedId/matches (x6, mirror round 1 matchups)
```

### 9.3 Submit scores for sessions 4–6 (both tournaments)

Same flow as Phase 6. For paired: submit scores → calculate team scores → verify match completion. For open: submit scores → verify handicap updates.

### 9.4 Verify cumulative handicap progression (open)

After 6 sessions, handicap should reflect all historical data:
```
GET /api/tournaments/:openId/players/:aliceId/statistics
Assert: gamesPlayed === 18 (6 sessions * 3 games)
  - currentAverage is stable around player's skill level
  - currentHandicap reflects cumulative average
```

---

## Phase 10 — Final Statistics & Standings

### 10.1 Paired tournament final standings
```
GET /api/tournaments/:pairedId/standings
Assert: 200
  - 4 teams, ranked 1–4
  - matchesPlayed === 6 (3 per round-robin * 2 rounds, if Option B in Phase 9)
  - totalPoints consistent (winner has more points)
  - winPercentage > 0 for at least one team
```

### 10.2 Open tournament final standings
```
GET /api/tournaments/:openId/standings
Assert: 200
  - 12 players, ranked 1–12
  - sessionsPlayed === 6 for all players
  - totalPins includes handicap
  - tournamentAverage is reasonable (100–250 range)
  - rank ordering matches totalPins DESC
```

### 10.3 Cross-tournament player statistics
```
GET /api/players/:daveId/statistics
Assert: 200
  - Array includes stats for BOTH tournaments
  - Different stats for each (pins vs points context)
```

### 10.4 Player dashboard
```
GET /api/players/:daveId/dashboard
Assert: 200
  - player details present
  - currentTeams includes Strike Force
  - overallStatistics has tournamentsPlayed >= 2
  - recentScores has entries
```

### 10.5 Tournament-wide statistics comparison
```
GET /api/tournaments/:pairedId/statistics
GET /api/tournaments/:openId/statistics
Assert:
  - Both have totalPlayers === 12
  - Paired has completedMatches === totalMatches
  - Open has no matches (totalMatches === 0)
```

### 10.6 Verify each league has its tournament
```
GET /api/leagues/:pairedLeagueId/editions
Assert: 1 edition, linked to the paired tournament

GET /api/leagues/:openLeagueId/editions
Assert: 1 edition, linked to the open tournament
```

---

## Edge Cases to Cover

### Schedule
- Preview with < 2 teams → 400
- Generate with existing matches → 400
- Delete schedule with recorded scores → 400

### Registration
- Register same team twice → 400
- Register player to team not in tournament → 400
- Register when tournament is full (set maxTeams low for one test) → 400

### Scoring
- Submit more than `gamesPerSession` scores → 400
- Submit to nonexistent session → 404
- Duplicate submission → 400
- Score out of 0–300 range → 400

### Statistics
- Standings for tournament with no scores → 200, empty array
- Player statistics for player with no scores → 200, zeroed values

---

## Implementation Notes

1. **Deterministic scores**: Use fixed score arrays, not random. This makes assertions predictable. Define all score data at the top of the file as constants.

2. **Shared state**: Use module-level variables for IDs (league, teams, players, tournaments, matches). Populate in `beforeAll` or early `it()` blocks.

3. **Test ordering**: Tests within each `describe` block run sequentially and depend on prior state. This is intentional for e2e — each phase builds on the previous.

4. **Parallel match scoring**: Within a session, submit all player scores before calculating team scores. This mirrors realistic usage.

5. **Helper functions**: Extract repetitive patterns:
   - `submitPlayerScores(tournamentId, sessionNumber, playerId, teamId, scores)` → POST scores
   - `completeMatch(matchId, homeTeamId, awayTeamId)` → calculate both team scores
   - `getMatchesForSession(tournamentId, sessionNumber)` → fetch match list

6. **Assertion helpers**:
   - `expectValidStandings(body, expectedCount)` → validates structure
   - `expectHandicap(playerId, tournamentId, expectedHdcp)` → checks player_statistics
