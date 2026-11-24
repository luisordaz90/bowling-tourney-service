const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authorize');
const requireTeamContext = require('../middleware/requireTeamContext');
const { submitScore, getScores, updateScore, deleteScore } = require('../controllers/scoresController');

const deprecate = (replacement) => (req, res, next) => {
  const logger = require('../config/logger');
  logger.warn({ deprecated: req.originalUrl, replacement }, 'Deprecated endpoint called.');
  res.set('Deprecation', 'true');
  res.set('Link', `</api${replacement}>; rel="successor-version"`);
  next();
};

router.post('/:tournamentId/sessions/:sessionNumber/scores', deprecate('/scores'), requireTeamContext, authorize('score:submit'), submitScore);
router.get('/:tournamentId/sessions/:sessionNumber/scores', deprecate('/scores'), getScores);
router.put('/:tournamentId/sessions/:sessionNumber/scores/:playerId', deprecate('/scores/:playerId'), updateScore);
router.delete('/:tournamentId/sessions/:sessionNumber/scores/:playerId', deprecate('/scores/:playerId'), deleteScore);

module.exports = router;
