# OAS Update Summary - 2026-06-21

## Total Endpoints Documented: 48

### By Tag

| Tag | Count | Endpoints |
|-----|-------|-----------|
| Health | 1 | GET /api/health |
| Tournaments | 5 | CRUD + list |
| Registration | 6 | Team reg, player roster (add/list/remove for both) |
| Schedule | 9 | Sessions CRUD, round-robin preview/generate, schedule summary/validate/delete, tournament matches list/create |
| Scoring | 4 | Submit/get/update/delete scores |
| Standings & Statistics | 6 | Standings, tournament stats, per-player/team stats, all-players/teams stats |
| Teams | 5 | CRUD + list |
| Players | 8 | CRUD + dashboard/teams/statistics/league-history |
| Matches | 6 | Get match, update status, player-scores, team-scores (get/post), calculate |
| Sessions | 1 | Update session status |
| Leagues | 5 | CRUD (no delete) + validate-assignment + violations |
| Player Statistics | 1 | PUT upsert |
| Team Statistics | 1 | PUT upsert |

## Resources and Fields

### Tournament
id, name, description, startDate, endDate, maxTeams, totalSessions, sessionType, status, sessionsCompleted, leagueId, scheduleType, rankingMethod, hdcpBase, hdcpPercentage, season, year, gamesPerSession, createdAt, updatedAt

### Team
id, name, captainName, captainEmail, captainPhone, status, createdAt, updatedAt

### Player
id, name, email, phone, handicap, averageScore, totalGamesPlayed, totalPins, createdAt, updatedAt

### League
id, name, description, leagueType, status, maxTeamsPerTournament, createdAt, updatedAt

### Session (tournament_sessions)
id, tournamentId, sessionNumber, sessionName, sessionDate, status, notes, createdAt
Enriched: + matchCount, completedMatches, scheduledMatches, inProgressMatches, isComplete

### Match
id, tournamentId, homeTeamId, awayTeamId, sessionId, sessionNumber, matchDate, matchName, status, winnerTeamId, createdAt, updatedAt
Enriched: + homeTeamDetails, awayTeamDetails, winnerTeamDetails, sessionDetails

### TournamentTeam (registration)
id, tournamentId, teamId, seedNumber, totalTournamentScore, gamesPlayedInTournament, sessionsPlayedInTournament, registrationDate, status, teamDetails{}

### TeamPlayer (roster)
id, teamId, playerId, tournamentId, role, isActive, joinedDate, leftDate, playerDetails{}

### Score (session-scoped)
tournamentId, sessionNumber, playerId, playerName, teamId, teamName, matchId, scores[], handicapApplied, totalPins, sessionAverage, recordedAt

### MatchPlayerScore
playerId, teamId, playerName, teamName, game1Score, game2Score, game3Score, handicapApplied, createdAt

### MatchTeamScore
teamId, teamName, totalTeamScore, totalHandicap, teamAverage, gamesPlayed, recordedAt

### PointsStanding (points ranking_method)
teamId, teamName, captainName, totalScore, gamesPlayed, averageScore, matchesPlayed, matchesWon, matchesLost, winPercentage, totalPoints, pointsPercentage, maxPossiblePoints, seedNumber, status, rank

### PinsStanding (pins ranking_method)
playerId, playerName, teamId, teamName, sessionsPlayed, totalPins, tournamentAverage, rank

### TournamentStatistics
totalTeams, totalPlayers, totalGames, highestGame, highestSeries, averageScore, sessionsCompleted, totalSessions, totalMatches, completedMatches, scheduledMatches, pointSystem{}

### PlayerTournamentStats
playerId, tournamentId, gamesPlayed, totalPins, currentAverage, highestGame, highestSeries, matchesPlayed, matchesContributedToWin, currentHandicap

### TeamTournamentStats
teamId, tournamentId, totalMatchesPlayed, matchesWon, matchesLost, totalTeamScore, teamAverage, totalPoints, pointsPercentage, maxPossiblePoints, rankPosition, pointsBreakdown{}

## Decisions

1. **Response envelope**: All responses use the Phase 1 envelope format `{ data: <Resource> }` for single items and `{ data: [...], pagination: {...} }` for lists. The current controllers do NOT wrap in `{ data }` yet -- the OAS documents the target format that Phase 1 will introduce.

2. **Standings polymorphism**: The GET standings endpoint uses `oneOf` since it returns either PointsStanding[] or PinsStanding[] depending on the tournament's `rankingMethod`.

3. **camelCase fields**: All schema field names are camelCase, matching the `outputFormatter` middleware behavior.

4. **DELETE score uses request body**: The delete score endpoint accepts `teamId` in the request body (required for paired format). This is unusual for DELETE but matches the current controller.

5. **Match player-scores are pivoted**: `getPlayersMatchScore` returns game1Score/game2Score/game3Score columns (pivoted), not an array. This differs from the session scores endpoint which returns a `scores[]` array.

6. **Match team-scores GET vs POST**: GET returns computed aggregates from scores table. POST (`addTeamScoreInMatch` / `calculateTeamScoreInMatch`) triggers point calculation and match completion.

## Unclear Endpoints

1. **updatePlayerStatistics / updateTeamStatistics**: These are admin-level upsert endpoints. The response status logic (`result.rows.length === 0 ? 201 : 200`) is buggy -- `RETURNING *` always returns rows on upsert, so the response will always be 200.

2. **removeTeamFromTournament**: Returns 200 with a message, not 204. The spec documents what the controller actually does.

3. **removePlayerFromTournamentRoster**: Soft-deletes (sets `is_active = false`), returns 200 with message.
