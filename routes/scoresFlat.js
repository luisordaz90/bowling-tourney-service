const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authorize');
const requireTeamContext = require('../middleware/requireTeamContext');
const { submitScore, getScores, updateScore, deleteScore } = require('../controllers/scoresFlatController');

router.post('/', requireTeamContext, authorize('score:submit'), submitScore);
router.get('/', getScores);
router.put('/:playerId', authorize('score:update'), updateScore);
router.delete('/:playerId', authorize('score:delete'), deleteScore);

module.exports = router;
