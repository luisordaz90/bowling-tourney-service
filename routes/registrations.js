const express = require('express');
const router = express.Router();
const {
  registerTeam,
  getRegisteredTeams,
  unregisterTeam,
  registerPlayer,
  getRegisteredPlayers,
  removePlayer
} = require('../controllers/registrationsController');

// Team registration
router.post('/teams', registerTeam);
router.get('/teams', getRegisteredTeams);
router.delete('/teams/:teamId', unregisterTeam);

// Player roster
router.post('/players', registerPlayer);
router.get('/players', getRegisteredPlayers);
router.delete('/players/:playerId', removePlayer);

module.exports = router;
