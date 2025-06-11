const { v4: uuidv4 } = require('uuid');
const { tournaments, teams } = require('../models');
const { findById, findByIndex } = require('../utils/helpers');

const createTeam = (req, res) => {
  try {
    const { name, captainName, captainEmail, captainPhone } = req.body;
    
    if (!name || !captainName || !captainEmail) {
      return res.status(400).json({ error: 'Team name, captain name, and captain email are required' });
    }

    // Check if team name already exists
    const existingTeam = teams.find(team => team.name === name);
    if (existingTeam) {
      return res.status(400).json({ error: 'Team name already exists' });
    }

    const team = {
      id: uuidv4(),
      name,
      captainName,
      captainEmail,
      captainPhone: captainPhone || null,
      status: 'active',
      registrationDate: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    teams.push(team);
    res.status(201).json(team);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create team' });
  }
};

const getTeams = (req, res) => {
  res.json(teams);
}

const getTeamById = (req, res) => {
  const team = findById(teams, req.params.id);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }
  res.json(team);
};

const updateTeam = (req, res) => {
  const index = findByIndex(teams, req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Team not found' });
  }

  const { name, captainName, captainEmail, captainPhone, status } = req.body;
  const team = teams[index];

  teams[index] = {
    ...team,
    name: name || team.name,
    captainName: captainName || team.captainName,
    captainEmail: captainEmail || team.captainEmail,
    captainPhone: captainPhone !== undefined ? captainPhone : team.captainPhone,
    status: status || team.status
  };

  res.json(teams[index]);
};

const deleteTeam = (req, res) => {
  try {
    const teamIndex = findByIndex(teams, req.params.id);
    if (teamIndex === -1) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const teamId = req.params.id;

    // Check if team is part of any active tournaments
    const activeRegistrations = tournamentTeams.filter(tt => tt.teamId === teamId);
    if (activeRegistrations.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete team that is registered in tournaments. Please withdraw from tournaments first.' 
      });
    }

    // Remove related data
    teamPlayers.splice(0, teamPlayers.length, ...teamPlayers.filter(tp => tp.teamId !== teamId));
    playerMatchScores.splice(0, playerMatchScores.length, ...playerMatchScores.filter(pms => pms.teamId !== teamId));
    teamMatchScores.splice(0, teamMatchScores.length, ...teamMatchScores.filter(tms => tms.teamId !== teamId));
    playerStatistics.splice(0, playerStatistics.length, ...playerStatistics.filter(ps => ps.teamId !== teamId));
    teamStatistics.splice(0, teamStatistics.length, ...teamStatistics.filter(ts => ts.teamId !== teamId));

    // Remove the team
    teams.splice(teamIndex, 1);

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete team' });
  }
}

module.exports = {
  createTeam,
  getTeamById,
  getTeams,
  updateTeam,
  deleteTeam
};