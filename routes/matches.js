const express = require('express');
const router = express.Router();
const {
    addPlayerScoreInMatch,
    getPlayersMatchScore,
    addTeamScoreInMatch,
    getTeamsScoreInMatch,
    getMatchById,
    updateMatchStatus,
    calculateTeamScoreInMatch
} = require('../controllers/matchesController');

router.get('/:matchId', getMatchById);
router.put('/:matchId/status', updateMatchStatus);

router.post('/:matchId/player-scores', addPlayerScoreInMatch);
router.get('/:matchId/player-scores', getPlayersMatchScore);

router.post('/:matchId/team-scores', addTeamScoreInMatch);
router.get('/:matchId/team-scores', getTeamsScoreInMatch);

router.post('/:matchId/team-scores/calculate', calculateTeamScoreInMatch);

module.exports = router;