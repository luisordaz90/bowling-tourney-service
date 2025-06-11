const { matches, playerMatchScores, players, teamMatchScores } = require('../models');
const { findById, findByIndex } = require('../utils/helpers');

const getMatchById =  (req, res) => {
  const match = findById(matches, req.params.id);
  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }
  res.json(match);
};

const updateMatchStatus = (req, res) => {
  const index = findByIndex(matches, req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Match not found' });
  }

  const { status } = req.body;
  if (!['scheduled', 'in_progress', 'completed', 'cancelled', 'postponed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  matches[index].status = status;
  matches[index].updatedAt = new Date();
  res.json(matches[index]);
};

const addPlayerScoreInMatch = (req, res) => {
  try {
    const match = findById(matches, req.params.matchId);
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const { teamId, playerId, game1Score, game2Score, game3Score, handicapApplied } = req.body;
    
    if (!teamId || !playerId || game1Score === undefined || game2Score === undefined || game3Score === undefined) {
      return res.status(400).json({ error: 'Team ID, Player ID, and all three game scores are required' });
    }

    // Validate scores (0-300 for each game)
    const games = [game1Score, game2Score, game3Score];
    if (games.some(score => score < 0 || score > 300)) {
      return res.status(400).json({ error: 'Game scores must be between 0 and 300' });
    }

    // Verify team and player exist and are part of the match
    if (teamId !== match.homeTeamId && teamId !== match.awayTeamId) {
      return res.status(400).json({ error: 'Team is not part of this match' });
    }

    const totalScore = game1Score + game2Score + game3Score;
    const handicap = handicapApplied || 0;
    const finalScore = totalScore + handicap;

    const playerMatchScore = {
      id: uuidv4(),
      matchId: req.params.matchId,
      teamId,
      playerId,
      game1Score,
      game2Score,
      game3Score,
      totalScore,
      handicapApplied: handicap,
      finalScore,
      recordedAt: new Date()
    };

    playerMatchScores.push(playerMatchScore);

    // Update player statistics
    const playerIndex = findByIndex(players, playerId);
    if (playerIndex !== -1) {
      const player = players[playerIndex];
      player.totalGamesPlayed += 3;
      player.totalPins += totalScore;
      player.averageScore = parseFloat((player.totalPins / player.totalGamesPlayed).toFixed(2));
      player.updatedAt = new Date();
    }

    res.status(201).json(playerMatchScore);
  } catch (error) {
    res.status(500).json({ error: 'Failed to record player match score' });
  }
};

const getPlayersMatchScore = (req, res) => {
  const matchPlayerScores = playerMatchScores.filter(pms => pms.matchId === req.params.matchId);
  res.json(matchPlayerScores);
}

const addTeamScoreInMatch = (req, res) => {
  try {
    const match = findById(matches, req.params.matchId);
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const { teamId } = req.body;
    
    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    // Verify team is part of the match
    if (teamId !== match.homeTeamId && teamId !== match.awayTeamId) {
      return res.status(400).json({ error: 'Team is not part of this match' });
    }

    // Calculate team scores from player scores
    const teamPlayerScores = playerMatchScores.filter(pms => 
      pms.matchId === req.params.matchId && pms.teamId === teamId
    );

    if (teamPlayerScores.length === 0) {
      return res.status(400).json({ error: 'No player scores found for this team in this match' });
    }

    const totalTeamScore = teamPlayerScores.reduce((sum, pms) => sum + pms.totalScore, 0);
    const totalHandicap = teamPlayerScores.reduce((sum, pms) => sum + pms.handicapApplied, 0);
    const finalTeamScore = totalTeamScore + totalHandicap;
    const gamesPlayed = teamPlayerScores.length * 3;
    const teamAverage = parseFloat((totalTeamScore / gamesPlayed).toFixed(2));

    const teamMatchScore = {
      id: uuidv4(),
      matchId: req.params.matchId,
      teamId,
      totalTeamScore,
      totalHandicap,
      finalTeamScore,
      teamAverage,
      gamesPlayed,
      recordedAt: new Date()
    };

    teamMatchScores.push(teamMatchScore);
    res.status(201).json(teamMatchScore);
  } catch (error) {
    res.status(500).json({ error: 'Failed to record team match score' });
  }
};

const getTeamsScoreInMatch = (req, res) => {
  const matchTeamScores = teamMatchScores.filter(tms => tms.matchId === req.params.matchId);
  res.json(matchTeamScores);
};

module.exports = {
    addPlayerScoreInMatch,
    getPlayersMatchScore,
    addTeamScoreInMatch,
    getTeamsScoreInMatch,
    getMatchById,
    updateMatchStatus
};