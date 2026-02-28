const { v4: uuidv4 } = require('uuid');
const { leagueDays, teams, players, scores } = require('../models');
const { findById, findByIndex, validateScore } = require('../utils/helpers');
const logger = require('../config/logger');

const createScore = (req, res) => {
  try {
    const leagueDay = findById(leagueDays, req.params.leagueDayId);
    if (!leagueDay) {
      return res.status(404).json({ error: 'League day not found' });
    }

    const { teamId, playerId, game1, game2, game3, handicap } = req.body;
    
    if (!teamId || !playerId || game1 === undefined || game2 === undefined || game3 === undefined) {
      return res.status(400).json({ error: 'Team ID, Player ID, and all three game scores are required' });
    }

    // Validate scores
    const games = [game1, game2, game3];
    if (!games.every(validateScore)) {
      return res.status(400).json({ error: 'Game scores must be between 0 and 300' });
    }

    const totalScore = game1 + game2 + game3;
    const handicapScore = handicap || 0;
    const finalScore = totalScore + handicapScore;

    const score = {
      id: uuidv4(),
      leagueDayId: req.params.leagueDayId,
      teamId,
      playerId,
      game1,
      game2,
      game3,
      totalScore,
      handicap: handicapScore,
      finalScore,
      createdAt: new Date()
    };

    scores.push(score);

    // Update player statistics
    const playerIndex = findByIndex(players, playerId);
    if (playerIndex !== -1) {
      const player = players[playerIndex];
      player.gamesPlayed += 3;
      player.totalPins += totalScore;
      player.averageScore = Math.round(player.totalPins / player.gamesPlayed);
    }

    // Update team statistics
    const teamIndex = findByIndex(teams, teamId);
    if (teamIndex !== -1) {
      const team = teams[teamIndex];
      team.gamesPlayed += 3;
      team.totalScore += finalScore;
    }

    res.status(201).json((score));
  } catch (error) {
    logger.error('Error recording score:', error);
    res.status(500).json({ error: 'Failed to record score' });
  }
};

const getScoresByLeagueDay = (req, res) => {
  const leagueDayScores = scores.filter(score => score.leagueDayId === req.params.leagueDayId);
  res.json((leagueDayScores));
};

const getScoresByTeam = (req, res) => {
  const { leagueDayId } = req.query;
  let teamScores = scores.filter(score => score.teamId === req.params.teamId);
  
  if (leagueDayId) {
    teamScores = teamScores.filter(score => score.leagueDayId === leagueDayId);
  }
  
  res.json((teamScores));
};

const getScoresByPlayer = (req, res) => {
  const playerScores = scores.filter(score => score.playerId === req.params.playerId);
  res.json((playerScores));
};

module.exports = {
  createScore,
  getScoresByLeagueDay,
  getScoresByTeam,
  getScoresByPlayer
};