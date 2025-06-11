const { v4: uuidv4 } = require('uuid');
const { teams, players, teamPlayers, playerStatistics, playerMatchScores } = require('../models');
const { findById, findByIndex } = require('../utils/helpers');

const createPlayer = (req, res) => {
  try {
    const { name, email, phone, handicap } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    // Check if email already exists (if provided)
    if (email) {
      const existingPlayer = players.find(player => player.email === email);
      if (existingPlayer) {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }

    const player = {
      id: uuidv4(),
      name,
      email: email || null,
      phone: phone || null,
      handicap: handicap ? parseInt(handicap) : 0,
      averageScore: 0.00,
      totalGamesPlayed: 0,
      totalPins: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    players.push(player);
    res.status(201).json(player);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create player' });
  }
}

const getPlayers = (req, res) => {
  res.json(players);
};

const getPlayerById = (req, res) => {
  const player = findById(players, req.params.id);
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }
  res.json(player);
};

const getPlayersByTeam = (req, res) => {
  const teamPlayers = players.filter(player => player.teamId === req.params.teamId);
  res.json(teamPlayers);
};

const deletePlayer = (req, res) => {
  try {
    const playerIndex = findByIndex(players, req.params.id);
    if (playerIndex === -1) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const playerId = req.params.id;

    // Check if player has recorded scores
    const playerScores = playerMatchScores.filter(pms => pms.playerId === playerId);
    if (playerScores.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete player with recorded match scores. Player data is needed for historical records.' 
      });
    }

    // Remove related data
    teamPlayers.splice(0, teamPlayers.length, ...teamPlayers.filter(tp => tp.playerId !== playerId));
    playerStatistics.splice(0, playerStatistics.length, ...playerStatistics.filter(ps => ps.playerId !== playerId));

    // Remove the player
    players.splice(playerIndex, 1);

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete player' });
  }
}

module.exports = {
  createPlayer,
  deletePlayer,
  getPlayers,
  getPlayerById,
  getPlayersByTeam
};