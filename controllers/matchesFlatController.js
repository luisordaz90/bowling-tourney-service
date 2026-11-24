// controllers/matchesFlatController.js
// Flat match endpoints.
const { query } = require('../config/database');
const { toCamelCase } = require('../utils/helpers');
const matchesController = require('./matchesController');
const scheduleController = require('./scheduleController');

const listMatches = async (req, res) => {
  const { tournamentId, sessionNumber } = req.query;
  if (!tournamentId) {
    return res.status(400).json({ error: 'tournamentId query param is required' });
  }

  // If sessionNumber provided, use getRoundMatches; otherwise getAllMatchesForTournament
  req.params = { ...req.params, tournamentId };
  if (sessionNumber) {
    req.params.sessionNumber = sessionNumber;
    return scheduleController.getRoundMatches(req, res);
  }
  return scheduleController.getAllMatchesForTournament(req, res);
};

const createMatch = async (req, res) => {
  const { tournamentId } = req.body;
  if (!tournamentId) {
    return res.status(400).json({ error: 'tournamentId is required in body' });
  }
  req.params = { ...req.params, tournamentId };
  return matchesController.createMatch(req, res);
};

module.exports = {
  listMatches,
  createMatch,
  // These are already flat (use :matchId param)
  getMatchById: matchesController.getMatchById,
  updateMatchStatus: matchesController.updateMatchStatus,
};
