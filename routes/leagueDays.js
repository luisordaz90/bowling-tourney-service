const express = require('express');
const router = express.Router();
const { updateLeagueDayStatus } = require('../controllers/leagueDayController');
const { getScoresByLeagueDay, createScore } = require('../controllers/scoreController');

router.put('/:id/status', updateLeagueDayStatus);
router.get('/:leagueDayId/scores', getScoresByLeagueDay);
router.post('/:leagueDayId/scores', createScore);

module.exports = router;