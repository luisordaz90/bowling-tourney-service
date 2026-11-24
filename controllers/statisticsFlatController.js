// controllers/statisticsFlatController.js
// Flat statistics endpoints — tournamentId from query/body, shimmed to existing controller.
const statisticsController = require('./statisticsController');

function shim(handler) {
  return async (req, res) => {
    const tournamentId = req.query?.tournamentId || req.body?.tournamentId;
    if (!tournamentId) {
      return res.status(400).json({ error: 'tournamentId is required' });
    }
    req.params = { ...req.params, tournamentId };
    return handler(req, res);
  };
}

module.exports = {
  getStandings: shim(statisticsController.getStandings),
  getStatistics: shim(statisticsController.getStatistics),
  getPlayerStats: (req, res) => {
    const tournamentId = req.query?.tournamentId;
    if (!tournamentId) return res.status(400).json({ error: 'tournamentId is required' });
    req.params = { ...req.params, tournamentId };
    return statisticsController.getPlayerTournamentStatistics(req, res);
  },
  getAllPlayerStats: (req, res) => {
    const tournamentId = req.query?.tournamentId;
    if (!tournamentId) return res.status(400).json({ error: 'tournamentId is required' });
    req.params = { ...req.params, tournamentId };
    return statisticsController.getTournamentPlayersStatistics(req, res);
  },
  getTeamStats: (req, res) => {
    const tournamentId = req.query?.tournamentId;
    if (!tournamentId) return res.status(400).json({ error: 'tournamentId is required' });
    req.params = { ...req.params, tournamentId };
    return statisticsController.getTeamTournamentStatistics(req, res);
  },
  getAllTeamStats: (req, res) => {
    const tournamentId = req.query?.tournamentId;
    if (!tournamentId) return res.status(400).json({ error: 'tournamentId is required' });
    req.params = { ...req.params, tournamentId };
    return statisticsController.getTournamentTeamsStatistics(req, res);
  },
  updatePlayerStats: (req, res) => {
    const tournamentId = req.body?.tournamentId;
    if (!tournamentId) return res.status(400).json({ error: 'tournamentId is required in body' });
    req.params = { ...req.params, tournamentId };
    return statisticsController.updatePlayerStatistics(req, res);
  },
  updateTeamStats: (req, res) => {
    const tournamentId = req.body?.tournamentId;
    if (!tournamentId) return res.status(400).json({ error: 'tournamentId is required in body' });
    req.params = { ...req.params, tournamentId };
    return statisticsController.updateTeamStatistics(req, res);
  },
};
