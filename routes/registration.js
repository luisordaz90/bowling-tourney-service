const express = require('express');
const router = express.Router();
const {
  registerTeamToTournament,
  getRegisteredTeamsInTournament,
  removeTeamFromTournament,
  registerPlayerToTeamInTournament,
  getRegisteredPlayersInRegisteredTeamInTournament,
  removePlayerFromTournamentRoster
} = require('../controllers/registrationController');

router.post('/:tournamentId/teams', registerTeamToTournament);
router.get('/:tournamentId/teams', getRegisteredTeamsInTournament);
router.delete('/:tournamentId/teams/:teamId', removeTeamFromTournament);

router.post('/:tournamentId/teams/:teamId/players', registerPlayerToTeamInTournament);
router.get('/:tournamentId/teams/:teamId/players', getRegisteredPlayersInRegisteredTeamInTournament);
router.delete('/:tournamentId/teams/:teamId/players/:playerId', removePlayerFromTournamentRoster);

module.exports = router;
