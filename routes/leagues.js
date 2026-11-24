const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authorize');
const {
  createLeague,
  getLeagues,
  getLeagueById,
  updateLeague,
  validatePlayerTeamAssignment,
  getLeagueViolations
} = require('../controllers/leagueController');
const {
  assignLeagueAdmin,
  removeLeagueAdmin
} = require('../controllers/leagueAdminController');

// League management routes
router.post('/', authorize('league:create'), createLeague);
router.get('/', getLeagues);
router.get('/:id', getLeagueById);
router.put('/:id', authorize('league:update'), updateLeague);

// League admin management (superadmin only)
router.post('/:leagueId/admins', authorize('league:admin:manage'), assignLeagueAdmin);
router.delete('/:leagueId/admins/:playerId', authorize('league:admin:manage'), removeLeagueAdmin);

// Validation and eligibility routes
router.post('/validate-assignment', validatePlayerTeamAssignment);
router.get('/:leagueId/violations', getLeagueViolations);

module.exports = router;
