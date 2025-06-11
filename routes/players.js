const express = require('express');
const router = express.Router();
const { createPlayer, getPlayers, getPlayerById, deletePlayer } = require('../controllers/playerController');

router.post('/', createPlayer);
router.get('/', getPlayers);
router.get('/:id', getPlayerById);
router.delete('/:id', deletePlayer)

module.exports = router;