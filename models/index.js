// In-memory storage (replace with database in production)
let tournaments = [];
let teams = [];
let players = [];
let leagueSessions = [];
let matches = [];
let tournamentTeams = [];
let teamPlayers = [];
let playerMatchScores = [];
let teamMatchScores = [];
let playerStatistics = [];
let teamStatistics = [];

// Export data arrays
module.exports = {
  tournaments,
  teams,
  players,
  leagueSessions,
  matches,
  tournamentTeams,
  teamPlayers,
  playerMatchScores,
  teamMatchScores,
  playerStatistics,
  teamStatistics
};