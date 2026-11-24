const express = require('express');
const router = express.Router();
const {
  getMyTeams,
  getMyLeagues,
  getMyDashboard,
  getMyStatistics,
  getMyLeagueHistory,
} = require('../controllers/meController');

router.get('/teams', getMyTeams);
router.get('/leagues', getMyLeagues);
router.get('/dashboard', getMyDashboard);
router.get('/statistics', getMyStatistics);
router.get('/league-history', getMyLeagueHistory);

module.exports = router;
