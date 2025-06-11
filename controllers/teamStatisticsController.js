const { teamStatistics } = require('../models');
const { findById } = require('../utils/helpers');

const updateTeamStatistics = (req, res) => {
  try {
    const team = findById(teams, req.params.teamId);
    const tournament = findById(tournaments, req.params.tournamentId);
    
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const { totalMatchesPlayed, matchesWon, matchesLost, totalTeamScore, teamAverage, rankPosition } = req.body;

    // Find existing statistics record
    const existingStatIndex = teamStatistics.findIndex(ts => 
      ts.teamId === req.params.teamId && 
      ts.tournamentId === req.params.tournamentId
    );

    const statisticsData = {
      teamId: req.params.teamId,
      tournamentId: req.params.tournamentId,
      totalMatchesPlayed: totalMatchesPlayed || 0,
      matchesWon: matchesWon || 0,
      matchesLost: matchesLost || 0,
      totalTeamScore: totalTeamScore || 0,
      teamAverage: teamAverage || 0.00,
      rankPosition: rankPosition || null,
      lastUpdated: new Date()
    };

    if (existingStatIndex !== -1) {
      // Update existing record
      teamStatistics[existingStatIndex] = {
        ...teamStatistics[existingStatIndex],
        ...statisticsData
      };
      res.json(teamStatistics[existingStatIndex]);
    } else {
      // Create new record
      const newTeamStat = {
        id: uuidv4(),
        ...statisticsData
      };
      teamStatistics.push(newTeamStat);
      res.status(201).json(newTeamStat);
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to update team statistics' });
  }
}

module.exports = {
  updateTeamStatistics
};