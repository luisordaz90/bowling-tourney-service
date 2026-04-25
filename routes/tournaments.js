const express = require('express');
const router = express.Router();
const {
  createTournament,
  getAllTournaments,
  getTournamentById,
  updateTournament,
  deleteTournament
} = require('../controllers/tournamentController');

router.post('/', createTournament);
router.get('/', getAllTournaments);
router.get('/:id', getTournamentById);
router.put('/:id', updateTournament);
router.delete('/:id', deleteTournament);

module.exports = router;
