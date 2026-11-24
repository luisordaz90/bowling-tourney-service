const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authorize');
const {
  createPlayer,
  getPlayers,
  getPlayerById,
  deletePlayer,
  getPlayerDashboard,
  getPlayerTeams,
  getPlayerStatistics
} = require('../controllers/playerController');
const { getPlayerLeagueHistory } = require('../controllers/leagueController');

router.post('/', authorize('player:create'), createPlayer);
router.get('/', getPlayers);
router.get('/:id', getPlayerById);
router.delete('/:id', deletePlayer);

// Deprecated -- use /api/me/* instead
const deprecate = (replacement) => (req, res, next) => {
  const logger = require('../config/logger');
  logger.warn({ deprecated: req.originalUrl, replacement }, 'Deprecated endpoint called. Use the /api/me/* equivalent.');
  res.set('Deprecation', 'true');
  res.set('Link', `</api${replacement}>; rel="successor-version"`);
  next();
};

router.get('/:playerId/dashboard', deprecate('/me/dashboard'), getPlayerDashboard);
router.get('/:playerId/teams', deprecate('/me/teams'), getPlayerTeams);
router.get('/:playerId/statistics', deprecate('/me/statistics'), getPlayerStatistics);
router.get('/:playerId/league-history', deprecate('/me/league-history'), getPlayerLeagueHistory);

module.exports = router;