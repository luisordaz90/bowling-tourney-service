const express = require('express');
const router = express.Router();

// Statistics routes are handled in tournaments.js as they are tournament-specific
// - Tournament standings: /api/tournaments/:tournamentId/standings
// - Tournament statistics: /api/tournaments/:tournamentId/statistics

module.exports = router;