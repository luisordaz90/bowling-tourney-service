const express = require('express');
const router = express.Router();
const { 
  createPlayer, 
  getPlayers, 
  getPlayerById, 
  deletePlayer,
  getPlayerDashboard,
  getPlayerTeams,
  getPlayerStatistics
} = require('../controllers/playerController');
const { getPlayerLeagueHistory } = require('../controllers/leagueController');

router.post('/', createPlayer);
router.get('/', getPlayers);
router.get('/:id', getPlayerById);
router.delete('/:id', deletePlayer);

// New player-centric endpoints
router.get('/:playerId/dashboard', getPlayerDashboard);
router.get('/:playerId/teams', getPlayerTeams);
router.get('/:playerId/statistics', getPlayerStatistics);
router.get('/:playerId/league-history', getPlayerLeagueHistory);

module.exports = router;