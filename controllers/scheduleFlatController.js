// controllers/scheduleFlatController.js
// Flat schedule endpoints — tournamentId comes from body/query instead of URL params.
// Delegates to existing scheduleController logic by shimming req.params.tournamentId.
const scheduleController = require('./scheduleController');

// Helper: shim req.params.tournamentId from body or query, then delegate
function shim(handler) {
  return async (req, res) => {
    const tournamentId = req.body?.tournamentId || req.query?.tournamentId;
    if (!tournamentId) {
      return res.status(400).json({ error: 'tournamentId is required' });
    }
    req.params = { ...req.params, tournamentId };
    return handler(req, res);
  };
}

module.exports = {
  previewSchedule: shim(scheduleController.previewMatchMaking),
  generateSchedule: shim(scheduleController.generateMatches),
  getScheduleSummary: shim(scheduleController.getTournamentSchedule),
  deleteSchedule: shim(scheduleController.deleteTournamentSchedule),
  validateSchedule: shim(scheduleController.validateTournamentSchedule),
};
