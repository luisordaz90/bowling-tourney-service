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

const deprecate = (replacement) => (req, res, next) => {
  const logger = require('../config/logger');
  logger.warn({ deprecated: req.originalUrl, replacement }, 'Deprecated endpoint called. Use the /api/registrations/* equivalent.');
  res.set('Deprecation', 'true');
  res.set('Link', `</api${replacement}>; rel="successor-version"`);
  next();
};

router.post('/:tournamentId/teams', deprecate('/registrations/teams'), registerTeamToTournament);
router.get('/:tournamentId/teams', deprecate('/registrations/teams'), getRegisteredTeamsInTournament);
router.delete('/:tournamentId/teams/:teamId', deprecate('/registrations/teams/:teamId'), removeTeamFromTournament);

router.post('/:tournamentId/teams/:teamId/players', deprecate('/registrations/players'), registerPlayerToTeamInTournament);
router.get('/:tournamentId/teams/:teamId/players', deprecate('/registrations/players'), getRegisteredPlayersInRegisteredTeamInTournament);
router.delete('/:tournamentId/teams/:teamId/players/:playerId', deprecate('/registrations/players/:playerId'), removePlayerFromTournamentRoster);

module.exports = router;
