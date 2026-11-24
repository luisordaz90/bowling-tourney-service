const express = require('express');
const router = express.Router();
const {
  registerSessionToTournament,
  getSessionsForTournament,
  previewMatchMaking,
  generateMatches,
  getTournamentSchedule,
  deleteTournamentSchedule,
  validateTournamentSchedule,
  getRoundMatches,
  getAllMatchesForTournament
} = require('../controllers/scheduleController');
const { createMatch } = require('../controllers/matchesController');

const deprecate = (replacement) => (req, res, next) => {
  const logger = require('../config/logger');
  logger.warn({ deprecated: req.originalUrl, replacement }, 'Deprecated endpoint called.');
  res.set('Deprecation', 'true');
  res.set('Link', `</api${replacement}>; rel="successor-version"`);
  next();
};

router.post('/:tournamentId/sessions', deprecate('/sessions'), registerSessionToTournament);
router.get('/:tournamentId/sessions', deprecate('/sessions'), getSessionsForTournament);
router.get('/:tournamentId/sessions/:sessionNumber/matches', deprecate('/sessions/:sessionNumber/matches'), getRoundMatches);

router.get('/:tournamentId/schedule/round-robin/preview', deprecate('/schedule/preview'), previewMatchMaking);
router.post('/:tournamentId/schedule/round-robin', deprecate('/schedule/generate'), generateMatches);
router.get('/:tournamentId/schedule/summary', deprecate('/schedule/summary'), getTournamentSchedule);
router.delete('/:tournamentId/schedule', deprecate('/schedule'), deleteTournamentSchedule);
router.get('/:tournamentId/schedule/validate', deprecate('/schedule/validate'), validateTournamentSchedule);

router.post('/:tournamentId/matches', createMatch);
router.get('/:tournamentId/matches', getAllMatchesForTournament);

module.exports = router;
