const { playerStatistics } = require('../models');
const { findById } = require('../utils/helpers');

const updatePlayerStatistics = (req, res) => {
  try {
    const player = findById(players, req.params.playerId);
    const tournament = findById(tournaments, req.params.tournamentId);
    
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const { teamId, gamesPlayed, totalPins, currentAverage, highestGame, highestSeries, matchesPlayed } = req.body;

    // Find existing statistics record
    const existingStatIndex = playerStatistics.findIndex(ps => 
      ps.playerId === req.params.playerId && 
      ps.tournamentId === req.params.tournamentId &&
      ps.teamId === teamId
    );

    const statisticsData = {
      playerId: req.params.playerId,
      tournamentId: req.params.tournamentId,
      teamId: teamId || null,
      gamesPlayed: gamesPlayed || 0,
      totalPins: totalPins || 0,
      currentAverage: currentAverage || 0.00,
      highestGame: highestGame || 0,
      highestSeries: highestSeries || 0,
      matchesPlayed: matchesPlayed || 0,
      lastUpdated: new Date()
    };

    if (existingStatIndex !== -1) {
      // Update existing record
      playerStatistics[existingStatIndex] = {
        ...playerStatistics[existingStatIndex],
        ...statisticsData
      };
      res.json(playerStatistics[existingStatIndex]);
    } else {
      // Create new record
      const newPlayerStat = {
        id: uuidv4(),
        ...statisticsData
      };
      playerStatistics.push(newPlayerStat);
      res.status(201).json(newPlayerStat);
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to update player statistics' });
  }
}

module.exports = {
  updatePlayerStatistics
};