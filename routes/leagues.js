const express = require('express');
const router = express.Router();
const {
  createLeague,
  getLeagues,
  getLeagueById,
  updateLeague,
  createTournamentEdition,
  getLeagueEditions,
  getTournamentEditionById,
  validatePlayerTeamAssignment,
  getPlayerLeagueHistory,
  getLeagueViolations
} = require('../controllers/leagueController');

// League management routes
router.post('/', createLeague);
router.get('/', getLeagues);
router.get('/:id', getLeagueById);
router.put('/:id', updateLeague);

// Tournament edition routes
router.post('/:leagueId/editions', createTournamentEdition);
router.get('/:leagueId/editions', getLeagueEditions);
router.get('/:leagueId/editions/:editionId', getTournamentEditionById);

// Validation and eligibility routes
router.post('/validate-assignment', validatePlayerTeamAssignment);
router.get('/:leagueId/violations', getLeagueViolations);

module.exports = router;