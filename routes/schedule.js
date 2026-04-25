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

router.post('/:tournamentId/sessions', registerSessionToTournament);
router.get('/:tournamentId/sessions', getSessionsForTournament);
router.get('/:tournamentId/sessions/:sessionNumber/matches', getRoundMatches);

router.get('/:tournamentId/schedule/round-robin/preview', previewMatchMaking);
router.post('/:tournamentId/schedule/round-robin', generateMatches);
router.get('/:tournamentId/schedule/summary', getTournamentSchedule);
router.delete('/:tournamentId/schedule', deleteTournamentSchedule);
router.get('/:tournamentId/schedule/validate', validateTournamentSchedule);

router.post('/:tournamentId/matches', createMatch);
router.get('/:tournamentId/matches', getAllMatchesForTournament);

module.exports = router;
