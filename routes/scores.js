const express = require('express');
const router = express.Router();

// Score routes are handled in other route files based on their relationships
// - Team scores: /api/teams/:teamId/scores
// - Player scores: /api/players/:playerId/scores  
// - League day scores: /api/league-days/:leagueDayId/scores

module.exports = router;