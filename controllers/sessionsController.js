const { leagueSessions } = require('../models');
const { findById, findByIndex } = require('../utils/helpers');

const updateSessionStatus = (req, res) => {
  const index = findByIndex(leagueSessions, req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'League session not found' });
  }

  const { status } = req.body;
  if (!['scheduled', 'active', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  leagueSessions[index].status = status;
  res.json(leagueSessions[index]);
}

module.exports = {
    updateSessionStatus
};