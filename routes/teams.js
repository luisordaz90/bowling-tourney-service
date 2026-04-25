const express = require('express');
const router = express.Router();
const { getTeamById, updateTeam, getTeams, createTeam, deleteTeam } = require('../controllers/teamController');

router.get('/', getTeams);
router.post('/', createTeam);
router.get('/:id', getTeamById);
router.put('/:id', updateTeam);
router.delete('/:id', deleteTeam);

module.exports = router;