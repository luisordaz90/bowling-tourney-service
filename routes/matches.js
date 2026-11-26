const express = require('express');
const router = express.Router();
const {
    getPlayersMatchScore,
    addTeamScoreInMatch,
    getTeamsScoreInMatch,
    calculateTeamScoreInMatch
} = require('../controllers/matchesController');

const deprecate = (replacement) => (req, res, next) => {
  const logger = require('../config/logger');
  logger.warn({ deprecated: req.originalUrl, replacement }, 'Deprecated endpoint called.');
  res.set('Deprecation', 'true');
  res.set('Link', `</api${replacement}>; rel="successor-version"`);
  next();
};

// GET /:matchId and PUT /:matchId/status are served by matchesFlat.js (mounted first)

router.get('/:matchId/player-scores', getPlayersMatchScore);

// Manual team-score endpoints — deprecated, auto-calculation handles this
router.post('/:matchId/team-scores', deprecate('/scores'), addTeamScoreInMatch);
router.get('/:matchId/team-scores', getTeamsScoreInMatch);
router.post('/:matchId/team-scores/calculate', deprecate('/scores'), calculateTeamScoreInMatch);

module.exports = router;
