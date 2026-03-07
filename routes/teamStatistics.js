const express = require('express');
const router = express.Router();
const { updateTeamStatistics } = require('../controllers/statisticsController');

router.put('/:teamId/:tournamentId', updateTeamStatistics);

module.exports = router;