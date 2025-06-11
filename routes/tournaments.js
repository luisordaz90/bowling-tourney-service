const express = require('express');
const router = express.Router();
const {
  registerTeamToTournament,
  registerPlayerToTeamInTournament,
  getRegisteredPlayersInRegisteredTeamInTournament,
  registerSessionToTournament,
  getRegisteredSessionsInTournament,
  createTournament,
  deleteTournament,
  getAllTournaments,
  getRegisteredTeamsInTournament,
  getTournamentById,
  getTournamentPlayersStatistics,
  getTournamentTeamsStatistics,
  getTournamentSchedule,
  deleteTournamentSchedule,
  validateTournamentSchedule,
  getRoundMatches,
  previewMatchMaking,
  generateMatches,
  updateTournament
} = require('../controllers/tournamentController');
const { getLeagueDaysByTournament, createLeagueDay } = require('../controllers/leagueDayController');
const { getStandings, getStatistics, getPlayerTournamentStatistics, getTeamTournamentStatistics } = require('../controllers/statisticsController');

// Tournament CRUD
router.post('/', createTournament);
router.get('/', getAllTournaments);
router.get('/:id', getTournamentById);
router.put('/:id', updateTournament);
router.delete('/:id', deleteTournament);

// Team Tournament related resources
router.post('/:tournamentId/teams', registerTeamToTournament);
router.get('/:tournamentId/teams', getRegisteredTeamsInTournament);

// Player + Team Tournament related resources
router.post('/:tournamentId/teams/:teamId/players', registerPlayerToTeamInTournament);
router.get('/:tournamentId/teams/:teamId/players', getRegisteredPlayersInRegisteredTeamInTournament);

// Session Tournament related resources
router.post('/:tournamentId/session', registerSessionToTournament);
router.get(':tournamentId/sessions', getRegisteredSessionsInTournament);

router.get('/:tournamentId/standings', getStandings);
router.get('/:tournamentId/statistics', getStatistics);
router.get('/:tournamentId/players/:playerId/statistics', getPlayerTournamentStatistics);
router.get('/:tournamentId/teams/:teamId/statistics', getTeamTournamentStatistics);

router.get('/:tournamentId/player-statistics', getTournamentPlayersStatistics)
router.get('/:tournamentId/team-statistics', getTournamentTeamsStatistics);

router.get('/:tournamentId/schedule/round-robin/preview', previewMatchMaking);
router.post('/:tournamentId/schedule/round-robin', generateMatches);
router.get('/:tournamentId/schedule/summary', getTournamentSchedule);
router.delete('/:tournamentId/schedule', deleteTournamentSchedule);;
//router.get('/:tournamentId/sessions/:sessionNumber/matches', validateSessionsInTournament);
router.get('/:tournamentId/schedule/validate', validateTournamentSchedule);
router.get('/:tournamentId/sessions/:sessionNumber/matches', getRoundMatches);

module.exports = router;