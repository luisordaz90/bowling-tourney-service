// controllers/scoresFlatController.js
// Flat score endpoints — tournamentId/sessionNumber from body/query, shimmed to existing controller.
const scoresController = require('./scoresController');

function shimScores(handler, { paramsFromBody = false } = {}) {
  return async (req, res) => {
    const tournamentId = paramsFromBody ? req.body?.tournamentId : (req.body?.tournamentId || req.query?.tournamentId);
    const sessionNumber = paramsFromBody ? req.body?.sessionNumber : (req.body?.sessionNumber || req.query?.sessionNumber);

    if (!tournamentId || !sessionNumber) {
      return res.status(400).json({ error: 'tournamentId and sessionNumber are required' });
    }

    req.params = { ...req.params, tournamentId, sessionNumber };
    return handler(req, res);
  };
}

module.exports = {
  submitScore: shimScores(scoresController.submitScore, { paramsFromBody: true }),
  getScores: shimScores(scoresController.getScores),
  updateScore: shimScores(scoresController.updateScore),
  deleteScore: shimScores(scoresController.deleteScore),
};
