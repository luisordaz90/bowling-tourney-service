const { v4: uuidv4 } = require('uuid');
const { tournaments, leagueDays } = require('../models');
const { findById, findByIndex } = require('../utils/helpers');

const createLeagueDay = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const { date, week, description } = req.body;
    
    if (!date || !week) {
      return res.status(400).json({ error: 'Date and week are required' });
    }

    const leagueDay = {
      id: uuidv4(),
      tournamentId: req.params.tournamentId,
      date: new Date(date),
      week: parseInt(week),
      description: description || `Week ${week}`,
      status: 'scheduled',
      createdAt: new Date()
    };

    leagueDays.push(leagueDay);
    res.status(201).json(leagueDay);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create league day' });
  }
};

const getLeagueDaysByTournament = (req, res) => {
  const tournamentLeagueDays = leagueDays.filter(day => day.tournamentId === req.params.tournamentId);
  res.json(tournamentLeagueDays.sort((a, b) => a.week - b.week));
};

const updateLeagueDayStatus = (req, res) => {
  const index = findByIndex(leagueDays, req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'League day not found' });
  }

  const { status } = req.body;
  if (!['scheduled', 'in-progress', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  leagueDays[index].status = status;
  res.json(leagueDays[index]);
};

module.exports = {
  createLeagueDay,
  getLeagueDaysByTournament,
  updateLeagueDayStatus
};