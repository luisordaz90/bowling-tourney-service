const express = require('express');
const router = express.Router();
const {
    addPlayerScoreInMatch,
    getPlayersMatchScore,
    addTeamScoreInMatch,
    getTeamsScoreInMatch,
    getMatchById,
    updateMatchStatus
} = require('../controllers/matchesController');

router.get('/:id', getMatchById);
router.put('/:id/status', updateMatchStatus);

router.post('/:id/player-scores', addPlayerScoreInMatch);
router.get('/:id/player-scores', getPlayersMatchScore);

router.post('/:id/team-scores', addTeamScoreInMatch);
router.get('/:id/team-scores', getTeamsScoreInMatch);

module.exports = router;