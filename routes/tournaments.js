const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authorize');
const {
  createTournament,
  getAllTournaments,
  getTournamentById,
  updateTournament,
  deleteTournament
} = require('../controllers/tournamentController');

router.post('/', authorize('tournament:create'), createTournament);
router.get('/', getAllTournaments);
router.get('/:id', getTournamentById);
router.put('/:id', authorize('tournament:update'), updateTournament);
router.delete('/:id', authorize('tournament:delete'), deleteTournament);

module.exports = router;
