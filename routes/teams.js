const express = require('express');
const router = express.Router();
const { getTeamById, updateTeam, getTeams, createTeam, deleteTeam } = require('../controllers/teamController');
const { getPlayersByTeam, createPlayer } = require('../controllers/playerController');
const { getScoresByTeam } = require('../controllers/scoreController');

router.get('/', getTeams);
router.post('/', createTeam);
router.get('/:id', getTeamById);
router.put('/:id', updateTeam);
router.delete('/:id', deleteTeam);
// CHECK
// router.get('/:teamId/players', getPlayersByTeam);
// router.post('/:teamId/players', createPlayer);
// router.get('/:teamId/scores', getScoresByTeam);

module.exports = router;