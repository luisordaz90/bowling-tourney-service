const express = require('express');
const router = express.Router();
const { submitScore, getScores, updateScore, deleteScore } = require('../controllers/scoresController');

router.post('/:tournamentId/sessions/:sessionNumber/scores', submitScore);
router.get('/:tournamentId/sessions/:sessionNumber/scores', getScores);
router.put('/:tournamentId/sessions/:sessionNumber/scores/:playerId', updateScore);
router.delete('/:tournamentId/sessions/:sessionNumber/scores/:playerId', deleteScore);

module.exports = router;
