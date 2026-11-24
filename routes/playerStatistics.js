const express = require('express');
const router = express.Router();
const { updatePlayerStatistics } = require('../controllers/statisticsController');

const deprecate = (replacement) => (req, res, next) => {
  const logger = require('../config/logger');
  logger.warn({ deprecated: req.originalUrl, replacement }, 'Deprecated endpoint called.');
  res.set('Deprecation', 'true');
  res.set('Link', `</api${replacement}>; rel="successor-version"`);
  next();
};

router.put('/:playerId/:tournamentId', deprecate('/statistics/players/:playerId'), updatePlayerStatistics);

module.exports = router;