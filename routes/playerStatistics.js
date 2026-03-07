const express = require('express');
const router = express.Router();
const { updatePlayerStatistics } = require('../controllers/statisticsController');

router.put('/:playerId/:tournamentId', updatePlayerStatistics);

module.exports = router;