const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authorize');
const { listMatches, createMatch, getMatchById, updateMatchStatus } = require('../controllers/matchesFlatController');

router.get('/', listMatches);
router.post('/', authorize('match:create'), createMatch);
router.get('/:matchId', getMatchById);
router.put('/:matchId/status', authorize('match:update'), updateMatchStatus);

module.exports = router;
