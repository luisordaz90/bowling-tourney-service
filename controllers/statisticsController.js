const { tournaments, teams, players, playerMatchScores, teamMatchScores, tournamentTeams, teamPlayers, matches } = require('../models');
const { findById } = require('../utils/helpers');

const getStandings =  (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentTeamRegistrations = tournamentTeams.filter(tt => tt.tournamentId === req.params.tournamentId);
    const standings = tournamentTeamRegistrations.map(tt => {
      const team = findById(teams, tt.teamId);
      
      // Get team matches
      const teamMatches = matches.filter(match => 
        match.tournamentId === req.params.tournamentId && 
        (match.homeTeamId === tt.teamId || match.awayTeamId === tt.teamId)
      );

      // Calculate wins and losses
      const completedMatches = teamMatches.filter(match => match.status === 'completed');
      const matchesWon = completedMatches.filter(match => match.winnerTeamId === tt.teamId).length;
      const matchesLost = completedMatches.length - matchesWon;

      // Get team scores
      const teamScores = teamMatchScores.filter(tms => {
        const match = findById(matches, tms.matchId);
        return match && match.tournamentId === req.params.tournamentId && tms.teamId === tt.teamId;
      });

      const totalScore = teamScores.reduce((sum, tms) => sum + tms.finalTeamScore, 0);
      const totalGames = teamScores.reduce((sum, tms) => sum + tms.gamesPlayed, 0);
      const averageScore = totalGames > 0 ? parseFloat((totalScore / totalGames).toFixed(2)) : 0;

      return {
        teamId: tt.teamId,
        teamName: team ? team.name : 'Unknown Team',
        captainName: team ? team.captainName : 'Unknown Captain',
        totalScore,
        gamesPlayed: totalGames,
        averageScore,
        matchesPlayed: completedMatches.length,
        matchesWon,
        matchesLost,
        winPercentage: completedMatches.length > 0 ? Math.round((matchesWon / completedMatches.length) * 100) : 0,
        seedNumber: tt.seedNumber,
        status: tt.status
      };
    });

    // Sort by matches won (descending), then by total score (descending)
    standings.sort((a, b) => {
      if (b.matchesWon !== a.matchesWon) {
        return b.matchesWon - a.matchesWon;
      }
      return b.totalScore - a.totalScore;
    });

    // Add rank
    standings.forEach((team, index) => {
      team.rank = index + 1;
    });

    res.json(standings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get standings' });
  }
};

const getStatistics = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentTeamRegistrations = tournamentTeams.filter(tt => tt.tournamentId === req.params.tournamentId);
    const tournamentPlayerAssignments = teamPlayers.filter(tp => tp.tournamentId === req.params.tournamentId);
    const tournamentMatches = matches.filter(match => match.tournamentId === req.params.tournamentId);
    const tournamentPlayerScores = playerMatchScores.filter(pms => {
      const match = findById(matches, pms.matchId);
      return match && match.tournamentId === req.params.tournamentId;
    });

    const highestGame = tournamentPlayerScores.length > 0 ? 
      Math.max(...tournamentPlayerScores.flatMap(pms => [pms.game1Score, pms.game2Score, pms.game3Score])) : 0;
    const highestSeries = tournamentPlayerScores.length > 0 ? 
      Math.max(...tournamentPlayerScores.map(pms => pms.totalScore)) : 0;
    const totalGames = tournamentPlayerScores.length * 3;
    const totalPins = tournamentPlayerScores.reduce((sum, pms) => sum + pms.totalScore, 0);
    const averageScore = totalGames > 0 ? Math.round(totalPins / totalGames) : 0;

    const statistics = {
      totalTeams: tournamentTeamRegistrations.length,
      totalPlayers: tournamentPlayerAssignments.filter(tp => tp.isActive).length,
      totalGames,
      highestGame,
      highestSeries,
      averageScore,
      sessionsCompleted: tournament.sessionsCompleted,
      totalSessions: tournament.totalSessions,
      totalMatches: tournamentMatches.length,
      completedMatches: tournamentMatches.filter(match => match.status === 'completed').length,
      scheduledMatches: tournamentMatches.filter(match => match.status === 'scheduled').length
    };

    res.json(statistics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get statistics' });
  }
};

const getPlayerTournamentStatistics = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    const player = findById(players, req.params.playerId);
    
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Get player's scores in this tournament
    const playerScores = playerMatchScores.filter(pms => {
      const match = findById(matches, pms.matchId);
      return match && match.tournamentId === req.params.tournamentId && pms.playerId === req.params.playerId;
    });

    if (playerScores.length === 0) {
      return res.json({
        playerId: req.params.playerId,
        tournamentId: req.params.tournamentId,
        gamesPlayed: 0,
        totalPins: 0,
        currentAverage: 0,
// Player Statistics Routes (completing the cut-off route)
        highestGame: 0,
        highestSeries: 0,
        matchesPlayed: 0
      });
    }

    const totalPins = playerScores.reduce((sum, pms) => sum + pms.totalScore, 0);
    const gamesPlayed = playerScores.length * 3;
    const currentAverage = parseFloat((totalPins / gamesPlayed).toFixed(2));
    const highestGame = Math.max(...playerScores.flatMap(pms => [pms.game1Score, pms.game2Score, pms.game3Score]));
    const highestSeries = Math.max(...playerScores.map(pms => pms.totalScore));

    const statistics = {
      playerId: req.params.playerId,
      tournamentId: req.params.tournamentId,
      gamesPlayed,
      totalPins,
      currentAverage,
      highestGame,
      highestSeries,
      matchesPlayed: playerScores.length
    };

    res.json(statistics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get player statistics' });
  }
};

const getTeamTournamentStatistics = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    const team = findById(teams, req.params.teamId);
    
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // Get team's matches in this tournament
    const teamMatches = matches.filter(match => 
      match.tournamentId === req.params.tournamentId && 
      (match.homeTeamId === req.params.teamId || match.awayTeamId === req.params.teamId)
    );

    const completedMatches = teamMatches.filter(match => match.status === 'completed');
    const matchesWon = completedMatches.filter(match => match.winnerTeamId === req.params.teamId).length;
    const matchesLost = completedMatches.length - matchesWon;

    // Get team scores
    const teamScores = teamMatchScores.filter(tms => {
      const match = findById(matches, tms.matchId);
      return match && match.tournamentId === req.params.tournamentId && tms.teamId === req.params.teamId;
    });

    const totalTeamScore = teamScores.reduce((sum, tms) => sum + tms.finalTeamScore, 0);
    const totalGames = teamScores.reduce((sum, tms) => sum + tms.gamesPlayed, 0);
    const teamAverage = totalGames > 0 ? parseFloat((totalTeamScore / totalGames).toFixed(2)) : 0;

    // Calculate rank (position in standings)
    const standings = tournaments.find(t => t.id === req.params.tournamentId);
    let rankPosition = null;
    if (standings) {
      // This would typically call the standings endpoint logic
      // For simplicity, we'll calculate a basic rank here
      const tournamentTeamRegistrations = tournamentTeams.filter(tt => tt.tournamentId === req.params.tournamentId);
      const teamStandings = tournamentTeamRegistrations.map(tt => {
        const tMatches = matches.filter(match => 
          match.tournamentId === req.params.tournamentId && 
          (match.homeTeamId === tt.teamId || match.awayTeamId === tt.teamId) &&
          match.status === 'completed'
        );
        const tWins = tMatches.filter(match => match.winnerTeamId === tt.teamId).length;
        return { teamId: tt.teamId, wins: tWins };
      });
      
      teamStandings.sort((a, b) => b.wins - a.wins);
      rankPosition = teamStandings.findIndex(ts => ts.teamId === req.params.teamId) + 1;
    }

    const statistics = {
      teamId: req.params.teamId,
      tournamentId: req.params.tournamentId,
      totalMatchesPlayed: completedMatches.length,
      matchesWon,
      matchesLost,
      totalTeamScore,
      teamAverage,
      rankPosition
    };

    res.json(statistics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get team statistics' });
  }
};

module.exports = {
  getPlayerTournamentStatistics,
  getTeamTournamentStatistics,
  getStandings,
  getStatistics
};