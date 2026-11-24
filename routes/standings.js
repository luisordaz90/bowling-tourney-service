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

const deprecate = (replacement) => (req, res, next) => {
  const logger = require('../config/logger');
  logger.warn({ deprecated: req.originalUrl, replacement }, 'Deprecated endpoint called.');
  res.set('Deprecation', 'true');
  res.set('Link', `</api${replacement}>; rel="successor-version"`);
  next();
};

router.get('/:tournamentId/standings', deprecate('/standings'), getStandings);
router.get('/:tournamentId/statistics', deprecate('/statistics'), getStatistics);
router.get('/:tournamentId/players/:playerId/statistics', deprecate('/statistics/players/:playerId'), getPlayerTournamentStatistics);
router.get('/:tournamentId/teams/:teamId/statistics', deprecate('/statistics/teams/:teamId'), getTeamTournamentStatistics);
router.get('/:tournamentId/player-statistics', deprecate('/statistics/players'), getTournamentPlayersStatistics);
router.get('/:tournamentId/team-statistics', deprecate('/statistics/teams'), getTournamentTeamsStatistics);

module.exports = router;
