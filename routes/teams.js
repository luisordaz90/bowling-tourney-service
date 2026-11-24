const express = require('express');
const router = express.Router();
const { getTeamById, updateTeam, getTeams, createTeam, deleteTeam } = require('../controllers/teamController');

router.get('/', getTeams);
router.post('/', createTeam);
router.get('/:teamId', getTeamById);
router.put('/:teamId', updateTeam);
router.delete('/:teamId', deleteTeam);

module.exports = router;