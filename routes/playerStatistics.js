const express = require('express');
const router = express.Router();
const {
    updatePlayerStatistics
} = require('../controllers/playerStatisticsController')

router.put('/:id/:tournamentId', updatePlayerStatistics);

module.exports = router;