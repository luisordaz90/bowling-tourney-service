const express = require('express');
const router = express.Router();
const {
    updateTeamStatistics
} = require('../controllers/teamStatisticsController')

router.put('/:id/:tournamentId', updateTeamStatistics);

module.exports = router;