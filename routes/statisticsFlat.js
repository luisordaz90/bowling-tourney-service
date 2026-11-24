const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authorize');
const {
  getStatistics,
  getAllPlayerStats,
  getPlayerStats,
  getAllTeamStats,
  getTeamStats,
  updatePlayerStats,
  updateTeamStats,
} = require('../controllers/statisticsFlatController');

// Public — aggregate stats
router.get('/', getStatistics);

// Authenticated — detailed stats
router.get('/players', getAllPlayerStats);
router.get('/players/:playerId', getPlayerStats);
router.get('/teams', getAllTeamStats);
router.get('/teams/:teamId', getTeamStats);

// Admin only — manual corrections
router.put('/players/:playerId', authorize('statistics:update'), updatePlayerStats);
router.put('/teams/:teamId', authorize('statistics:update'), updateTeamStats);

module.exports = router;
