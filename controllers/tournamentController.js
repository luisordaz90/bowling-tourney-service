const { v4: uuidv4 } = require('uuid');
const { tournaments, teams, players, teamPlayers, playerMatchScores, tournamentTeams, matches, leagueSessions } = require('../models');
const { generateRoundRobinSchedule, validateRoundRobinSchedule, findById, findByIndex } = require('../utils/helpers');

const createTournament = (req, res) => {
  try {
    const { name, description, startDate, endDate, maxTeams, totalSessions, sessionType } = req.body;
    
    if (!name || !startDate || !endDate || !maxTeams || !totalSessions || !sessionType) {
      return res.status(400).json({ 
        error: 'Name, start date, end date, max teams, total sessions, and session type are required' 
      });
    }

    const tournament = {
      id: uuidv4(),
      name,
      description: description || null,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      maxTeams: parseInt(maxTeams),
      totalSessions: parseInt(totalSessions),
      sessionType,
      sessionsCompleted: 0,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    tournaments.push(tournament);
    res.status(201).json(tournament);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create tournament' });
  }
};

const getAllTournaments = (req, res) => {
  res.json(tournaments);
};

const getTournamentById = (req, res) => {
  const tournament = findById(tournaments, req.params.id);
  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }
  res.json(tournament);
};

const updateTournament = (req, res) => {
  const index = findByIndex(tournaments, req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  const { name, description, startDate, endDate, maxTeams, totalSessions, sessionType, status, sessionsCompleted } = req.body;
  const tournament = tournaments[index];

  // Validate status
  if (status && !['draft', 'active', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid tournament status' });
  }

  tournaments[index] = {
    ...tournament,
    name: name || tournament.name,
    description: description !== undefined ? description : tournament.description,
    startDate: startDate ? new Date(startDate) : tournament.startDate,
    endDate: endDate ? new Date(endDate) : tournament.endDate,
    maxTeams: maxTeams ? parseInt(maxTeams) : tournament.maxTeams,
    totalSessions: totalSessions ? parseInt(totalSessions) : tournament.totalSessions,
    sessionType: sessionType || tournament.sessionType,
    sessionsCompleted: sessionsCompleted !== undefined ? parseInt(sessionsCompleted) : tournament.sessionsCompleted,
    status: status || tournament.status,
    updatedAt: new Date()
  };

  res.json(tournaments[index]);
};

const deleteTournament = (req, res) => {
  try {
    const tournamentIndex = findByIndex(tournaments, req.params.id);
    if (tournamentIndex === -1) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentId = req.params.id;

    // Remove all related data (cascade delete simulation)
    leagueSessions.splice(0, leagueSessions.length, ...leagueSessions.filter(ls => ls.tournamentId !== tournamentId));
    matches.splice(0, matches.length, ...matches.filter(m => m.tournamentId !== tournamentId));
    tournamentTeams.splice(0, tournamentTeams.length, ...tournamentTeams.filter(tt => tt.tournamentId !== tournamentId));
    teamPlayers.splice(0, teamPlayers.length, ...teamPlayers.filter(tp => tp.tournamentId !== tournamentId));
    playerStatistics.splice(0, playerStatistics.length, ...playerStatistics.filter(ps => ps.tournamentId !== tournamentId));
    teamStatistics.splice(0, teamStatistics.length, ...teamStatistics.filter(ts => ts.tournamentId !== tournamentId));
    
    // Remove match-related scores for matches that belonged to this tournament
    const tournamentMatchIds = matches.filter(m => m.tournamentId === tournamentId).map(m => m.id);
    playerMatchScores.splice(0, playerMatchScores.length, ...playerMatchScores.filter(pms => !tournamentMatchIds.includes(pms.matchId)));
    teamMatchScores.splice(0, teamMatchScores.length, ...teamMatchScores.filter(tms => !tournamentMatchIds.includes(tms.matchId)));

    // Finally remove the tournament
    tournaments.splice(tournamentIndex, 1);

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete tournament' });
  }
};

const registerTeamToTournament =  (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const { teamId, seedNumber } = req.body;
    
    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    const team = findById(teams, teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // Check if tournament is full
    const tournamentTeamCount = tournamentTeams.filter(tt => tt.tournamentId === req.params.tournamentId).length;
    if (tournamentTeamCount >= tournament.maxTeams) {
      return res.status(400).json({ error: 'Tournament is full' });
    }

    // Check if team is already registered
    const existingRegistration = tournamentTeams.find(tt => 
      tt.tournamentId === req.params.tournamentId && tt.teamId === teamId
    );
    if (existingRegistration) {
      return res.status(400).json({ error: 'Team is already registered for this tournament' });
    }

    const tournamentTeam = {
      id: uuidv4(),
      tournamentId: req.params.tournamentId,
      teamId,
      seedNumber: seedNumber || null,
      totalTournamentScore: 0.00,
      gamesPlayedInTournament: 0,
      sessionsPlayedInTournament: 0,
      registrationDate: new Date(),
      status: 'registered'
    };

    tournamentTeams.push(tournamentTeam);
    res.status(201).json(tournamentTeam);
  } catch (error) {
    res.status(500).json({ error: 'Failed to register team for tournament' });
  }
}

const getRegisteredTeamsInTournament = (req, res) => {
  const tournamentTeamRegistrations = tournamentTeams.filter(tt => tt.tournamentId === req.params.tournamentId);
  const teamsWithDetails = tournamentTeamRegistrations.map(tt => {
    const team = findById(teams, tt.teamId);
    return {
      ...tt,
      teamDetails: team
    };
  });
  res.json(teamsWithDetails);
}

const registerPlayerToTeamInTournament =  (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    const team = findById(teams, req.params.teamId);
    
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const { playerId, role } = req.body;
    
    if (!playerId) {
      return res.status(400).json({ error: 'Player ID is required' });
    }

    const player = findById(players, playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Check if player is already assigned to this team in this tournament
    const existingAssignment = teamPlayers.find(tp => 
      tp.tournamentId === req.params.tournamentId && 
      tp.teamId === req.params.teamId && 
      tp.playerId === playerId
    );
    if (existingAssignment) {
      return res.status(400).json({ error: 'Player is already assigned to this team in this tournament' });
    }

    // Validate role
    const validRoles = ['captain', 'regular', 'substitute'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid player role' });
    }

    const teamPlayer = {
      id: uuidv4(),
      teamId: req.params.teamId,
      playerId,
      tournamentId: req.params.tournamentId,
      role: role || 'regular',
      isActive: true,
      joinedDate: new Date(),
      leftDate: null
    };

    teamPlayers.push(teamPlayer);
    res.status(201).json(teamPlayer);
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign player to team' });
  }

};

const getRegisteredPlayersInRegisteredTeamInTournament = (req, res) => {
  const teamPlayerAssignments = teamPlayers.filter(tp => 
    tp.tournamentId === req.params.tournamentId && 
    tp.teamId === req.params.teamId &&
    tp.isActive
  );
  
  const playersWithDetails = teamPlayerAssignments.map(tp => {
    const player = findById(players, tp.playerId);
    return {
      ...tp,
      playerDetails: player
    };
  });
  
  res.json(playersWithDetails);
};

const registerSessionToTournament = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const { sessionNumber, sessionName, sessionDate, notes } = req.body;
    
    if (!sessionNumber || !sessionDate) {
      return res.status(400).json({ error: 'Session number and session date are required' });
    }

    // Check if session number already exists for this tournament
    const existingSession = leagueSessions.find(ls => 
      ls.tournamentId === req.params.tournamentId && ls.sessionNumber === parseInt(sessionNumber)
    );
    if (existingSession) {
      return res.status(400).json({ error: 'Session number already exists for this tournament' });
    }

    const leagueSession = {
      id: uuidv4(),
      tournamentId: req.params.tournamentId,
      sessionNumber: parseInt(sessionNumber),
      sessionName: sessionName || `Session ${sessionNumber}`,
      sessionDate: new Date(sessionDate),
      status: 'scheduled',
      notes: notes || null,
      createdAt: new Date()
    };

    leagueSessions.push(leagueSession);
    res.status(201).json(leagueSession);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create league session' });
  }
};

const getRegisteredSessionsInTournament = (req, res) => {
  const tournamentSessions = leagueSessions.filter(ls => ls.tournamentId === req.params.tournamentId);
  res.json(tournamentSessions.sort((a, b) => a.sessionNumber - b.sessionNumber));
}

const getTournamentPlayersStatistics =  (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Get all player scores for this tournament and calculate statistics
    const tournamentPlayerScores = playerMatchScores.filter(pms => {
      const match = findById(matches, pms.matchId);
      return match && match.tournamentId === req.params.tournamentId;
    });

    // Group by player
    const playerStatsMap = {};
    
    tournamentPlayerScores.forEach(pms => {
      if (!playerStatsMap[pms.playerId]) {
        const player = findById(players, pms.playerId);
        playerStatsMap[pms.playerId] = {
          playerId: pms.playerId,
          playerName: player ? player.name : 'Unknown Player',
          teamId: pms.teamId,
          tournamentId: req.params.tournamentId,
          gamesPlayed: 0,
          totalPins: 0,
          currentAverage: 0,
          highestGame: 0,
          highestSeries: 0,
          matchesPlayed: 0,
          scores: []
        };
      }
      
      playerStatsMap[pms.playerId].scores.push(pms);
      playerStatsMap[pms.playerId].gamesPlayed += 3;
      playerStatsMap[pms.playerId].totalPins += pms.totalScore;
      playerStatsMap[pms.playerId].matchesPlayed += 1;
      
      // Update highest game
      const gameHighest = Math.max(pms.game1Score, pms.game2Score, pms.game3Score);
      if (gameHighest > playerStatsMap[pms.playerId].highestGame) {
        playerStatsMap[pms.playerId].highestGame = gameHighest;
      }
      
      // Update highest series
      if (pms.totalScore > playerStatsMap[pms.playerId].highestSeries) {
        playerStatsMap[pms.playerId].highestSeries = pms.totalScore;
      }
    });

    // Calculate averages
    Object.values(playerStatsMap).forEach(playerStats => {
      if (playerStats.gamesPlayed > 0) {
        playerStats.currentAverage = parseFloat((playerStats.totalPins / playerStats.gamesPlayed).toFixed(2));
      }
      delete playerStats.scores; // Remove detailed scores from response
    });

    const allPlayerStats = Object.values(playerStatsMap);
    
    // Sort by highest average
    allPlayerStats.sort((a, b) => b.currentAverage - a.currentAverage);

    res.json(allPlayerStats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get player statistics' });
  }
};

const getTournamentTeamsStatistics = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentTeamRegistrations = tournamentTeams.filter(tt => tt.tournamentId === req.params.tournamentId);
    
    const teamStats = tournamentTeamRegistrations.map(tt => {
      const team = findById(teams, tt.teamId);
      
      // Get team matches
      const teamMatches = matches.filter(match => 
        match.tournamentId === req.params.tournamentId && 
        (match.homeTeamId === tt.teamId || match.awayTeamId === tt.teamId)
      );

      const completedMatches = teamMatches.filter(match => match.status === 'completed');
      const matchesWon = completedMatches.filter(match => match.winnerTeamId === tt.teamId).length;
      const matchesLost = completedMatches.length - matchesWon;

      // Get team scores
      const teamScores = teamMatchScores.filter(tms => {
        const match = findById(matches, tms.matchId);
        return match && match.tournamentId === req.params.tournamentId && tms.teamId === tt.teamId;
      });

      const totalTeamScore = teamScores.reduce((sum, tms) => sum + tms.finalTeamScore, 0);
      const totalGames = teamScores.reduce((sum, tms) => sum + tms.gamesPlayed, 0);
      const teamAverage = totalGames > 0 ? parseFloat((totalTeamScore / totalGames).toFixed(2)) : 0;

      return {
        teamId: tt.teamId,
        teamName: team ? team.name : 'Unknown Team',
        tournamentId: req.params.tournamentId,
        totalMatchesPlayed: completedMatches.length,
        matchesWon,
        matchesLost,
        totalTeamScore,
        teamAverage,
        rankPosition: null // Will be calculated after sorting
      };
    });

    // Sort by matches won (descending), then by team average (descending)
    teamStats.sort((a, b) => {
      if (b.matchesWon !== a.matchesWon) {
        return b.matchesWon - a.matchesWon;
      }
      return b.teamAverage - a.teamAverage;
    });

    // Add rank positions
    teamStats.forEach((team, index) => {
      team.rankPosition = index + 1;
    });

    res.json(teamStats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get team statistics' });
  }
};

// Generate Round Robin Schedule (Preview)
const previewMatchMaking = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Get registered teams
    const tournamentTeamRegistrations = tournamentTeams.filter(tt => 
      tt.tournamentId === req.params.tournamentId && tt.status === 'registered'
    );

    if (tournamentTeamRegistrations.length < 2) {
      return res.status(400).json({ 
        error: 'At least 2 teams must be registered to generate round robin schedule' 
      });
    }

    const registeredTeams = tournamentTeamRegistrations.map(tt => {
      const team = findById(teams, tt.teamId);
      return {
        id: tt.teamId,
        name: team ? team.name : 'Unknown Team',
        seedNumber: tt.seedNumber
      };
    });

    // Sort by seed number if available
    registeredTeams.sort((a, b) => {
      if (a.seedNumber && b.seedNumber) {
        return a.seedNumber - b.seedNumber;
      }
      return a.name.localeCompare(b.name);
    });

    // Generate round robin schedule
    const schedule = generateRoundRobinSchedule(registeredTeams);
    
    // Validate the schedule
    const validationIssues = validateRoundRobinSchedule(schedule, registeredTeams.length);

    const totalMatches = schedule.reduce((sum, session) => sum + session.matches.length, 0);
    const expectedMatches = (registeredTeams.length * (registeredTeams.length - 1)) / 2;
    const hasOddTeams = registeredTeams.length % 2 === 1;
    const sessionsRequired = registeredTeams.length - 1;

    const preview = {
      tournamentId: req.params.tournamentId,
      totalTeams: registeredTeams.length,
      hasOddTeams,
      sessionsRequired,
      sessionsAvailable: tournament.totalSessions,
      canFitInTournament: tournament.totalSessions >= sessionsRequired,
      totalMatches,
      expectedMatches,
      matchesPerTeam: registeredTeams.length - 1,
      matchesPerSession: hasOddTeams ? Math.floor(registeredTeams.length / 2) : registeredTeams.length / 2,
      teamsPerSession: hasOddTeams ? registeredTeams.length - 1 : registeredTeams.length,
      schedule,
      validationIssues,
      isValidSchedule: validationIssues.length === 0,
      teams: registeredTeams,
      byeRotation: hasOddTeams ? schedule.map(s => ({ 
        session: s.sessionNumber, 
        byeTeam: s.byeTeam?.name || 'None' 
      })) : null
    };

    res.json(preview);
  } catch (error) {
    console.error('Error generating round robin preview:', error);
    res.status(500).json({ error: 'Failed to generate round robin schedule preview' });
  }
};

// // Create Round Robin Matches
const generateMatches = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Check if tournament already has matches
    const existingMatches = matches.filter(match => match.tournamentId === req.params.tournamentId);
    if (existingMatches.length > 0) {
      return res.status(400).json({ 
        error: 'Tournament already has scheduled matches. Delete existing matches first.' 
      });
    }

    const { 
      startDate = null,
      daysBetweenSessions = 7,
      overrideTeamOrder = null,
      forceCreate = false,
      sessionTimeSlots = null // Optional: specific time slots for each session
    } = req.body;

    // Get registered teams
    const tournamentTeamRegistrations = tournamentTeams.filter(tt => 
      tt.tournamentId === req.params.tournamentId && tt.status === 'registered'
    );

    if (tournamentTeamRegistrations.length < 2) {
      return res.status(400).json({ 
        error: 'At least 2 teams must be registered to generate round robin schedule' 
      });
    }

    let registeredTeams = tournamentTeamRegistrations.map(tt => {
      const team = findById(teams, tt.teamId);
      return {
        id: tt.teamId,
        name: team ? team.name : 'Unknown Team',
        seedNumber: tt.seedNumber
      };
    });

    // Use override order if provided, otherwise sort by seed
    if (overrideTeamOrder && Array.isArray(overrideTeamOrder)) {
      const orderedTeams = [];
      overrideTeamOrder.forEach(teamId => {
        const team = registeredTeams.find(t => t.id === teamId);
        if (team) orderedTeams.push(team);
      });
      registeredTeams = orderedTeams;
    } else {
      registeredTeams.sort((a, b) => {
        if (a.seedNumber && b.seedNumber) {
          return a.seedNumber - b.seedNumber;
        }
        return a.name.localeCompare(b.name);
      });
    }

    // Generate round robin schedule
    const schedule = generateRoundRobinSchedule(registeredTeams);
    const sessionsRequired = schedule.length;
    
    // Validate schedule
    const validationIssues = validateRoundRobinSchedule(schedule, registeredTeams.length);
    
    if (validationIssues.length > 0 && !forceCreate) {
      return res.status(400).json({
        error: 'Schedule validation failed. Use forceCreate=true to override.',
        validationIssues,
        schedule
      });
    }

    // Check if tournament has enough sessions
    if (tournament.totalSessions < sessionsRequired && !forceCreate) {
      return res.status(400).json({
        error: `Tournament needs ${sessionsRequired} sessions but only has ${tournament.totalSessions} configured. Update tournament.totalSessions or use forceCreate=true.`,
        sessionsRequired,
        sessionsAvailable: tournament.totalSessions
      });
    }

    // Calculate session dates
    const baseDate = startDate ? new Date(startDate) : new Date(tournament.startDate);
    const sessionDates = [];
    for (let i = 0; i < sessionsRequired; i++) {
      const sessionDate = new Date(baseDate);
      sessionDate.setDate(baseDate.getDate() + (i * daysBetweenSessions));
      
      // Apply custom time slots if provided
      if (sessionTimeSlots && sessionTimeSlots[i]) {
        const timeSlot = sessionTimeSlots[i];
        if (timeSlot.hour !== undefined) sessionDate.setHours(timeSlot.hour);
        if (timeSlot.minute !== undefined) sessionDate.setMinutes(timeSlot.minute);
      }
      
      sessionDates.push(sessionDate);
    }

    // Create matches
    const createdMatches = [];
    schedule.forEach((session, sessionIndex) => {
      const sessionDate = sessionDates[sessionIndex];
      
      session.matches.forEach((match, matchIndex) => {
        const matchData = {
          id: uuidv4(),
          tournamentId: req.params.tournamentId,
          homeTeamId: match.homeTeam.id,
          awayTeamId: match.awayTeam.id,
          sessionId: null, // Will be set after creating sessions
          sessionNumber: session.sessionNumber,
          weekNumber: session.sessionNumber, // Keep for backward compatibility
          matchDate: sessionDate,
          matchName: `Session ${session.sessionNumber} - ${match.homeTeam.name} vs ${match.awayTeam.name}`,
          status: 'scheduled',
          winnerTeamId: null,
          sessionMatchNumber: matchIndex + 1,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        matches.push(matchData);
        createdMatches.push(matchData);
      });
    });

    // Create sessions
    const createdSessions = [];
    schedule.forEach((session, index) => {
      const sessionExists = leagueSessions.find(ls => 
        ls.tournamentId === req.params.tournamentId && ls.sessionNumber === session.sessionNumber
      );
      
      if (!sessionExists) {
        const byeInfo = session.byeTeam ? ` (${session.byeTeam.name} has bye)` : '';
        const sessionData = {
          id: uuidv4(),
          tournamentId: req.params.tournamentId,
          sessionNumber: session.sessionNumber,
          sessionName: `Round Robin Session ${session.sessionNumber}`,
          sessionDate: sessionDates[index],
          status: 'scheduled',
          notes: `Automatically generated round robin session - ${session.matches.length} matches, ${session.teamsPlaying} teams playing${byeInfo}`,
          createdAt: new Date()
        };
        
        leagueSessions.push(sessionData);
        createdSessions.push(sessionData);
        
        // Update match sessionId references
        createdMatches
          .filter(match => match.sessionNumber === session.sessionNumber)
          .forEach(match => {
            match.sessionId = sessionData.id;
          });
      }
    });

    // Update tournament sessions count if needed
    if (tournament.totalSessions < sessionsRequired) {
      const tournamentIndex = findByIndex(tournaments, req.params.tournamentId);
      if (tournamentIndex !== -1) {
        tournaments[tournamentIndex].totalSessions = sessionsRequired;
        tournaments[tournamentIndex].updatedAt = new Date();
      }
    }

    const result = {
      tournamentId: req.params.tournamentId,
      totalMatchesCreated: createdMatches.length,
      totalSessionsCreated: createdSessions.length,
      totalTeams: registeredTeams.length,
      sessionsRequired,
      validationIssues,
      wasForced: validationIssues.length > 0 && forceCreate,
      schedule,
      createdMatches,
      createdSessions,
      scheduleInfo: {
        hasOddTeams: registeredTeams.length % 2 === 1,
        teamsPerSession: registeredTeams.length % 2 === 0 ? registeredTeams.length : registeredTeams.length - 1,
        matchesPerSession: Math.floor(registeredTeams.length / 2),
        byeSchedule: schedule.map(s => ({
          session: s.sessionNumber,
          byeTeam: s.byeTeam?.name || null
        }))
      }
    };

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating round robin matches:', error);
    res.status(500).json({ error: 'Failed to create round robin schedule' });
  }
};

// Get Tournament Schedule Summary
const getTournamentSchedule = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentMatches = matches.filter(match => match.tournamentId === req.params.tournamentId);
    const tournamentSessions = leagueSessions.filter(ls => ls.tournamentId === req.params.tournamentId);
    const registeredTeams = tournamentTeams.filter(tt => 
      tt.tournamentId === req.params.tournamentId && tt.status === 'registered'
    );

    // Group matches by session with team validation
    const sessionAnalysis = {};
    tournamentMatches.forEach(match => {
      const session = match.sessionNumber || 'Unassigned';
      if (!sessionAnalysis[session]) {
        sessionAnalysis[session] = {
          matches: [],
          teamsPlaying: new Set(),
          conflicts: []
        };
      }
      
      const sessionData = sessionAnalysis[session];
      sessionData.matches.push(match);
      
      // Check for team conflicts (team playing multiple matches in same session)
      if (sessionData.teamsPlaying.has(match.homeTeamId) || sessionData.teamsPlaying.has(match.awayTeamId)) {
        const homeTeam = findById(teams, match.homeTeamId);
        const awayTeam = findById(teams, match.awayTeamId);
        sessionData.conflicts.push({
          matchId: match.id,
          matchName: `${homeTeam?.name || 'Unknown'} vs ${awayTeam?.name || 'Unknown'}`,
          conflictingTeams: [
            sessionData.teamsPlaying.has(match.homeTeamId) ? homeTeam?.name : null,
            sessionData.teamsPlaying.has(match.awayTeamId) ? awayTeam?.name : null
          ].filter(Boolean)
        });
      }
      
      sessionData.teamsPlaying.add(match.homeTeamId);
      sessionData.teamsPlaying.add(match.awayTeamId);
    });

    // Calculate match statistics by status
    const matchStats = {
      total: tournamentMatches.length,
      scheduled: tournamentMatches.filter(m => m.status === 'scheduled').length,
      inProgress: tournamentMatches.filter(m => m.status === 'in_progress').length,
      completed: tournamentMatches.filter(m => m.status === 'completed').length,
      cancelled: tournamentMatches.filter(m => m.status === 'cancelled').length,
      postponed: tournamentMatches.filter(m => m.status === 'postponed').length
    };

    // Calculate expected vs actual matches for round robin
    const expectedMatches = registeredTeams.length >= 2 ? 
      (registeredTeams.length * (registeredTeams.length - 1)) / 2 : 0;
    const expectedSessions = registeredTeams.length >= 2 ? registeredTeams.length - 1 : 0;

    // Validate round robin completeness
    const isCompleteRoundRobin = tournamentMatches.length === expectedMatches;
    const hasCorrectSessions = tournamentSessions.length === expectedSessions;

    const summary = {
      tournamentId: req.params.tournamentId,
      totalTeams: registeredTeams.length,
      totalSessions: tournamentSessions.length,
      expectedSessions,
      hasCorrectSessions,
      matchStats,
      expectedMatches,
      isCompleteRoundRobin,
      sessionAnalysis: Object.keys(sessionAnalysis).sort().map(session => ({
        session: parseInt(session) || session,
        matchCount: sessionAnalysis[session].matches.length,
        teamsPlaying: sessionAnalysis[session].teamsPlaying.size,
        expectedTeamsPerSession: registeredTeams.length % 2 === 0 ? registeredTeams.length : registeredTeams.length - 1,
        hasConflicts: sessionAnalysis[session].conflicts.length > 0,
        conflicts: sessionAnalysis[session].conflicts,
        isValidSession: sessionAnalysis[session].conflicts.length === 0,
        matches: sessionAnalysis[session].matches
      })),
      hasScheduleConflicts: Object.values(sessionAnalysis).some(sa => sa.conflicts.length > 0),
      overallValidation: {
        allTeamsPlayingPerSession: Object.values(sessionAnalysis).every(sa => 
          sa.teamsPlaying.size === (registeredTeams.length % 2 === 0 ? registeredTeams.length : registeredTeams.length - 1)
        ),
        noTeamConflicts: Object.values(sessionAnalysis).every(sa => sa.conflicts.length === 0),
        completeRoundRobin: isCompleteRoundRobin
      },
      sessions: tournamentSessions.sort((a, b) => a.sessionNumber - b.sessionNumber)
    };

    res.json(summary);
  } catch (error) {
    console.error('Error getting schedule summary:', error);
    res.status(500).json({ error: 'Failed to get schedule summary' });
  }
};

// Clear Tournament Schedule
const deleteTournamentSchedule = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentMatches = matches.filter(match => match.tournamentId === req.params.tournamentId);
    const matchIds = tournamentMatches.map(match => match.id);

    // Check if any matches have been played (have scores)
    const hasScores = playerMatchScores.some(pms => matchIds.includes(pms.matchId)) ||
                     teamMatchScores.some(tms => matchIds.includes(tms.matchId));

    if (hasScores) {
      return res.status(400).json({ 
        error: 'Cannot clear schedule - some matches have recorded scores. Delete scores first.' 
      });
    }

    // Remove all matches for this tournament
    const removedMatchCount = tournamentMatches.length;
    matches.splice(0, matches.length, ...matches.filter(match => match.tournamentId !== req.params.tournamentId));

    // Remove auto-generated sessions
    const autoGeneratedSessions = leagueSessions.filter(ls => 
      ls.tournamentId === req.params.tournamentId && 
      ls.notes && ls.notes.includes('Automatically generated')
    );
    
    autoGeneratedSessions.forEach(session => {
      const sessionIndex = findByIndex(leagueSessions, session.id);
      if (sessionIndex !== -1) {
        leagueSessions.splice(sessionIndex, 1);
      }
    });

    res.json({
      message: 'Tournament schedule cleared successfully',
      removedMatches: removedMatchCount,
      removedSessions: autoGeneratedSessions.length
    });
  } catch (error) {
    console.error('Error clearing schedule:', error);
    res.status(500).json({ error: 'Failed to clear tournament schedule' });
  }
};

// Get Matches by Round/Week
const getRoundMatches = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const sessionNumber = parseInt(req.params.sessionNumber);
    const sessionMatches = matches.filter(match => 
      match.tournamentId === req.params.tournamentId && 
      match.sessionNumber === sessionNumber
    );

    // Get registered teams count for validation
    const registeredTeams = tournamentTeams.filter(tt => 
      tt.tournamentId === req.params.tournamentId && tt.status === 'registered'
    );

    // Validate session: no team plays twice, all teams play (except bye)
    const teamsInSession = new Set();
    const conflicts = [];
    
    sessionMatches.forEach(match => {
      if (teamsInSession.has(match.homeTeamId) || teamsInSession.has(match.awayTeamId)) {
        const homeTeam = findById(teams, match.homeTeamId);
        const awayTeam = findById(teams, match.awayTeamId);
        conflicts.push({
          matchId: match.id,
          homeTeam: homeTeam?.name,
          awayTeam: awayTeam?.name,
          conflictingTeams: [
            teamsInSession.has(match.homeTeamId) ? homeTeam?.name : null,
            teamsInSession.has(match.awayTeamId) ? awayTeam?.name : null
          ].filter(Boolean)
        });
      }
      teamsInSession.add(match.homeTeamId);
      teamsInSession.add(match.awayTeamId);
    });

    // Determine which team has bye (if any)
    let byeTeam = null;
    if (registeredTeams.length % 2 === 1) {
      const allTeamIds = registeredTeams.map(tt => tt.teamId);
      const playingTeamIds = Array.from(teamsInSession);
      const byeTeamId = allTeamIds.find(id => !playingTeamIds.includes(id));
      if (byeTeamId) {
        byeTeam = findById(teams, byeTeamId);
      }
    }

    // Enrich with team details
    const enrichedMatches = sessionMatches.map(match => {
      const homeTeam = findById(teams, match.homeTeamId);
      const awayTeam = findById(teams, match.awayTeamId);
      
      return {
        ...match,
        homeTeamDetails: homeTeam,
        awayTeamDetails: awayTeam
      };
    });

    const expectedTeamsPlaying = registeredTeams.length % 2 === 0 ? registeredTeams.length : registeredTeams.length - 1;
    const allTeamsPlaying = teamsInSession.size === expectedTeamsPlaying;

    res.json({
      tournamentId: req.params.tournamentId,
      session: sessionNumber,
      matchCount: enrichedMatches.length,
      teamsPlaying: teamsInSession.size,
      expectedTeamsPlaying,
      allTeamsPlaying,
      byeTeam: byeTeam ? { id: byeTeam.id, name: byeTeam.name } : null,
      hasConflicts: conflicts.length > 0,
      conflicts,
      isValidSession: conflicts.length === 0 && allTeamsPlaying,
      matches: enrichedMatches
    });
  } catch (error) {
    console.error('Error getting session matches:', error);
    res.status(500).json({ error: 'Failed to get session matches' });
  }
};

const getTournamentSessionOverview = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentMatches = matches.filter(match => match.tournamentId === req.params.tournamentId);
    const tournamentSessions = leagueSessions.filter(ls => ls.tournamentId === req.params.tournamentId);
    const registeredTeams = tournamentTeams.filter(tt => 
      tt.tournamentId === req.params.tournamentId && tt.status === 'registered'
    );

    // Group matches by session
    const sessionOverview = {};
    tournamentMatches.forEach(match => {
      const sessionNum = match.sessionNumber;
      if (!sessionOverview[sessionNum]) {
        sessionOverview[sessionNum] = {
          sessionNumber: sessionNum,
          matches: [],
          teamsPlaying: new Set()
        };
      }
      sessionOverview[sessionNum].matches.push(match);
      sessionOverview[sessionNum].teamsPlaying.add(match.homeTeamId);
      sessionOverview[sessionNum].teamsPlaying.add(match.awayTeamId);
    });

    // Add session details and calculate bye teams
    const sessionDetails = Object.values(sessionOverview).map(session => {
      const sessionData = tournamentSessions.find(s => s.sessionNumber === session.sessionNumber);
      
      // Find bye team if odd number of teams
      let byeTeam = null;
      if (registeredTeams.length % 2 === 1) {
        const allTeamIds = registeredTeams.map(tt => tt.teamId);
        const playingTeamIds = Array.from(session.teamsPlaying);
        const byeTeamId = allTeamIds.find(id => !playingTeamIds.includes(id));
        if (byeTeamId) {
          byeTeam = findById(teams, byeTeamId);
        }
      }

      const expectedTeamsPlaying = registeredTeams.length % 2 === 0 ? registeredTeams.length : registeredTeams.length - 1;
      
      return {
        sessionNumber: session.sessionNumber,
        sessionName: sessionData?.sessionName || `Session ${session.sessionNumber}`,
        sessionDate: sessionData?.sessionDate || null,
        status: sessionData?.status || 'scheduled',
        matchCount: session.matches.length,
        teamsPlaying: session.teamsPlaying.size,
        expectedTeamsPlaying,
        allTeamsPlaying: session.teamsPlaying.size === expectedTeamsPlaying,
        byeTeam: byeTeam ? { id: byeTeam.id, name: byeTeam.name } : null,
        isComplete: session.matches.every(m => m.status === 'completed'),
        matches: session.matches.map(match => {
          const homeTeam = findById(teams, match.homeTeamId);
          const awayTeam = findById(teams, match.awayTeamId);
          return {
            id: match.id,
            homeTeam: homeTeam ? { id: homeTeam.id, name: homeTeam.name } : null,
            awayTeam: awayTeam ? { id: awayTeam.id, name: awayTeam.name } : null,
            status: match.status,
            matchDate: match.matchDate
          };
        })
      };
    });

    // Sort by session number
    sessionDetails.sort((a, b) => a.sessionNumber - b.sessionNumber);

    const overview = {
      tournamentId: req.params.tournamentId,
      totalTeams: registeredTeams.length,
      totalSessions: sessionDetails.length,
      expectedSessions: registeredTeams.length - 1,
      hasOddTeams: registeredTeams.length % 2 === 1,
      teamsPerSession: registeredTeams.length % 2 === 0 ? registeredTeams.length : registeredTeams.length - 1,
      matchesPerSession: Math.floor(registeredTeams.length / 2),
      isCompleteSchedule: sessionDetails.length === (registeredTeams.length - 1) && 
                         sessionDetails.every(s => s.allTeamsPlaying),
      completedSessions: sessionDetails.filter(s => s.isComplete).length,
      sessions: sessionDetails
    };

    res.json(overview);
  } catch (error) {
    console.error('Error getting sessions overview:', error);
    res.status(500).json({ error: 'Failed to get sessions overview' });
  }
};

const validateTournamentSchedule = (req, res) => {
  try {
    const tournament = findById(tournaments, req.params.tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentMatches = matches.filter(match => match.tournamentId === req.params.tournamentId);
    const registeredTeams = tournamentTeams.filter(tt => 
      tt.tournamentId === req.params.tournamentId && tt.status === 'registered'
    );

    const validationResults = {
      tournamentId: req.params.tournamentId,
      totalTeams: registeredTeams.length,
      totalMatches: tournamentMatches.length,
      issues: [],
      warnings: [],
      isValid: true
    };

    // Validate basic requirements
    if (registeredTeams.length < 2) {
      validationResults.issues.push({
        type: 'INSUFFICIENT_TEAMS',
        message: 'Tournament needs at least 2 teams',
        teams: registeredTeams.length
      });
      validationResults.isValid = false;
    }

    // Validate match count for complete round robin
    const expectedMatches = (registeredTeams.length * (registeredTeams.length - 1)) / 2;
    if (tournamentMatches.length !== expectedMatches) {
      validationResults.issues.push({
        type: 'INCOMPLETE_ROUND_ROBIN',
        message: `Expected ${expectedMatches} matches for complete round robin, found ${tournamentMatches.length}`,
        expected: expectedMatches,
        actual: tournamentMatches.length,
        missing: expectedMatches - tournamentMatches.length
      });
      validationResults.isValid = false;
    }

    // Validate session distribution
    const sessionGroups = {};
    tournamentMatches.forEach(match => {
      const session = match.sessionNumber || 'unassigned';
      if (!sessionGroups[session]) {
        sessionGroups[session] = {
          matches: [],
          teams: new Set()
        };
      }
      sessionGroups[session].matches.push(match);
      sessionGroups[session].teams.add(match.homeTeamId);
      sessionGroups[session].teams.add(match.awayTeamId);
    });

    const expectedTeamsPerSession = registeredTeams.length % 2 === 0 ? registeredTeams.length : registeredTeams.length - 1;
    
    Object.keys(sessionGroups).forEach(sessionKey => {
      const session = sessionGroups[sessionKey];
      
      // Check if all teams are playing in this session (except bye team)
      if (session.teams.size !== expectedTeamsPerSession) {
        validationResults.issues.push({
          type: 'INCOMPLETE_SESSION',
          message: `Session ${sessionKey} has ${session.teams.size} teams playing, expected ${expectedTeamsPerSession}`,
          session: sessionKey,
          teamsPlaying: session.teams.size,
          expectedTeams: expectedTeamsPerSession
        });
        validationResults.isValid = false;
      }

      // Check for team conflicts (team playing multiple matches in same session)
      const teamMatchCount = {};
      session.matches.forEach(match => {
        teamMatchCount[match.homeTeamId] = (teamMatchCount[match.homeTeamId] || 0) + 1;
        teamMatchCount[match.awayTeamId] = (teamMatchCount[match.awayTeamId] || 0) + 1;
      });

      Object.keys(teamMatchCount).forEach(teamId => {
        if (teamMatchCount[teamId] > 1) {
          const team = findById(teams, teamId);
          validationResults.issues.push({
            type: 'TEAM_CONFLICT',
            message: `Team ${team?.name || teamId} plays ${teamMatchCount[teamId]} matches in session ${sessionKey}`,
            session: sessionKey,
            teamId,
            teamName: team?.name,
            matchCount: teamMatchCount[teamId]
          });
          validationResults.isValid = false;
        }
      });
    });

    // Validate matchup uniqueness
    const allMatchups = new Set();
    const duplicateMatchups = [];
    
    tournamentMatches.forEach(match => {
      const matchup = [match.homeTeamId, match.awayTeamId].sort().join('-');
      if (allMatchups.has(matchup)) {
        const homeTeam = findById(teams, match.homeTeamId);
        const awayTeam = findById(teams, match.awayTeamId);
        duplicateMatchups.push({
          matchup: `${homeTeam?.name || 'Unknown'} vs ${awayTeam?.name || 'Unknown'}`,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId
        });
      }
      allMatchups.add(matchup);
    });

    if (duplicateMatchups.length > 0) {
      validationResults.issues.push({
        type: 'DUPLICATE_MATCHUPS',
        message: 'Found duplicate matchups in tournament',
        duplicates: duplicateMatchups
      });
      validationResults.isValid = false;
    }

    // Check for missing matchups
    const expectedMatchups = new Set();
    for (let i = 0; i < registeredTeams.length; i++) {
      for (let j = i + 1; j < registeredTeams.length; j++) {
        const matchup = [registeredTeams[i].teamId, registeredTeams[j].teamId].sort().join('-');
        expectedMatchups.add(matchup);
      }
    }

    const missingMatchups = [];
    expectedMatchups.forEach(expectedMatchup => {
      if (!allMatchups.has(expectedMatchup)) {
        const [teamId1, teamId2] = expectedMatchup.split('-');
        const team1 = findById(teams, teamId1);
        const team2 = findById(teams, teamId2);
        missingMatchups.push({
          matchup: `${team1?.name || 'Unknown'} vs ${team2?.name || 'Unknown'}`,
          teamId1,
          teamId2
        });
      }
    });

    if (missingMatchups.length > 0) {
      validationResults.issues.push({
        type: 'MISSING_MATCHUPS',
        message: 'Missing matchups for complete round robin',
        missing: missingMatchups
      });
      validationResults.isValid = false;
    }

    // Add warnings for potential issues
    const expectedSessions = registeredTeams.length - 1;
    const actualSessions = Object.keys(sessionGroups).filter(k => k !== 'unassigned').length;
    
    if (actualSessions !== expectedSessions) {
      validationResults.warnings.push({
        type: 'SESSION_COUNT_MISMATCH',
        message: `Expected ${expectedSessions} sessions for optimal round robin, found ${actualSessions}`,
        expected: expectedSessions,
        actual: actualSessions
      });
    }

    if (sessionGroups.unassigned) {
      validationResults.warnings.push({
        type: 'UNASSIGNED_MATCHES',
        message: `${sessionGroups.unassigned.matches.length} matches are not assigned to any session`,
        count: sessionGroups.unassigned.matches.length
      });
    }

    res.json(validationResults);
  } catch (error) {
    console.error('Error validating tournament schedule:', error);
    res.status(500).json({ error: 'Failed to validate tournament schedule' });
  }
};

const getAllMatchesForTournament = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    
    // You can implement this by:
    // Option 1: Query matches directly if you have a tournamentId field in matches table
    // Option 2: Get matches through sessions/league days
    
    // Option 1 example:
    // const matches = await Match.findAll({
    //   where: { tournamentId },
    //   include: [
    //     { model: Team, as: 'homeTeam' },
    //     { model: Team, as: 'awayTeam' }
    //   ],
    //   order: [['sessionNumber', 'ASC'], ['matchDate', 'ASC']]
    // });
    
    // Option 2 example (through sessions):
    const sessions = await Session.findAll({
      where: { tournamentId },
      include: [{
        model: Match,
        include: [
          { model: Team, as: 'homeTeam' },
          { model: Team, as: 'awayTeam' }
        ]
      }],
      order: [['sessionNumber', 'ASC']]
    });
    
    // Flatten matches from all sessions
    const matches = sessions.flatMap(session => 
      session.matches.map(match => ({
        ...match.toJSON(),
        sessionNumber: session.sessionNumber,
        sessionDate: session.sessionDate
      }))
    );
    
    res.json(matches);
  } catch (error) {
    console.error('Error fetching tournament matches:', error);
    res.status(500).json({ error: 'Failed to fetch tournament matches' });
  }
};

const getSessionsForTournament = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    
    const sessions = await Session.findAll({
      where: { tournamentId },
      order: [['sessionNumber', 'ASC'], ['sessionDate', 'ASC']]
    });
    
    res.json(sessions);
  } catch (error) {
    console.error('Error fetching tournament sessions:', error);
    res.status(500).json({ error: 'Failed to fetch tournament sessions' });
  }
};

module.exports = {
  registerTeamToTournament,
  registerPlayerToTeamInTournament,
  getRegisteredPlayersInRegisteredTeamInTournament,
  registerSessionToTournament,
  getRegisteredSessionsInTournament,
  createTournament,
  deleteTournament,
  getAllTournaments,
  getRegisteredTeamsInTournament,
  getTournamentById,
  getTournamentSchedule,
  deleteTournamentSchedule,
  getTournamentPlayersStatistics,
  getTournamentTeamsStatistics,
  getTournamentSessionOverview,
  validateTournamentSchedule,
  getRoundMatches,
  getAllMatchesForTournament,
  previewMatchMaking,
  generateMatches,
  updateTournament,
  getSessionsForTournament
};