const express = require('express');
const router = express.Router();
const {
  getStandings,
  getStatistics,
  getPlayerTournamentStatistics,
  getTeamTournamentStatistics,
  getTournamentPlayersStatistics,
  getTournamentTeamsStatistics
} = require('../controllers/statisticsController');

router.get('/:tournamentId/standings', getStandings);
router.get('/:tournamentId/statistics', getStatistics);
router.get('/:tournamentId/players/:playerId/statistics', getPlayerTournamentStatistics);
router.get('/:tournamentId/teams/:teamId/statistics', getTeamTournamentStatistics);
router.get('/:tournamentId/player-statistics', getTournamentPlayersStatistics);
router.get('/:tournamentId/team-statistics', getTournamentTeamsStatistics);

module.exports = router;
