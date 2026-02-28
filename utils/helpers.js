const findById = (array, id) => array.find(item => item.id === id);
const findByIndex = (array, id) => array.findIndex(item => item.id === id);

const validateScore = (score) => score >= 0 && score <= 300;

const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const generateRoundRobinSchedule = (teams) => {
  const teamCount = teams.length;
  
  if (teamCount < 2) {
    throw new Error('At least 2 teams are required for round robin scheduling');
  }
  
  const hasOddTeams = teamCount % 2 === 1;
  const schedule = [];
  
  // Create list with dummy team if odd number
  let workingTeams = [...teams];
  if (hasOddTeams) {
    workingTeams.push({ id: 'BYE', name: 'BYE' });
  }
  
  const totalWorkingTeams = workingTeams.length;
  const sessionsNeeded = totalWorkingTeams - 1;
  
  // Simple round-robin using rotation method
  for (let session = 0; session < sessionsNeeded; session++) {
    const sessionMatches = [];
    
    // Create pairs for this session
    const sessionTeams = [...workingTeams];
    
    // Rotate all teams except the first one
    if (session > 0) {
      const fixed = sessionTeams[0];
      const rotating = sessionTeams.slice(1);
      
      // Rotate the non-fixed teams
      for (let i = 0; i < session; i++) {
        rotating.unshift(rotating.pop());
      }
      
      sessionTeams[0] = fixed;
      for (let i = 1; i < sessionTeams.length; i++) {
        sessionTeams[i] = rotating[i - 1];
      }
    }
    
    // Pair teams: first with last, second with second-to-last, etc.
    const numPairs = Math.floor(totalWorkingTeams / 2);
    for (let i = 0; i < numPairs; i++) {
      const team1 = sessionTeams[i];
      const team2 = sessionTeams[totalWorkingTeams - 1 - i];
      
      // Skip if either team is BYE
      if (team1.id !== 'BYE' && team2.id !== 'BYE') {
        sessionMatches.push({
          sessionNumber: session + 1,
          matchNumber: sessionMatches.length + 1,
          homeTeam: { id: team1.id, name: team1.name },
          awayTeam: { id: team2.id, name: team2.name }
        });
      }
    }
    
    // Find bye team for this session
    let byeTeam = null;
    if (hasOddTeams) {
      const playingTeamIds = new Set();
      sessionMatches.forEach(match => {
        playingTeamIds.add(match.homeTeam.id);
        playingTeamIds.add(match.awayTeam.id);
      });
      
      byeTeam = teams.find(team => !playingTeamIds.has(team.id));
    }
    
    const teamsPlaying = sessionMatches.length * 2;
    const expectedTeamsPlaying = hasOddTeams ? teamCount - 1 : teamCount;
    
    schedule.push({
      sessionNumber: session + 1,
      matches: sessionMatches,
      teamsPlaying,
      byeTeam,
      allTeamsIncluded: teamsPlaying === expectedTeamsPlaying
    });
  }
  
  return schedule;
};

const validateRoundRobinSchedule = (schedule, totalTeams) => {
  const issues = [];
  
  schedule.forEach(session => {
    const teamsInSession = new Set();
    
    // Check for duplicate teams in same session
    session.matches.forEach(match => {
      if (teamsInSession.has(match.homeTeam.id) || teamsInSession.has(match.awayTeam.id)) {
        issues.push({
          session: session.sessionNumber,
          issue: `Team playing multiple matches in session ${session.sessionNumber}`,
          match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
          conflictingTeam: teamsInSession.has(match.homeTeam.id) ? match.homeTeam.name : match.awayTeam.name
        });
      }
      teamsInSession.add(match.homeTeam.id);
      teamsInSession.add(match.awayTeam.id);
    });
    
    // Check if all teams are playing (except bye team for odd counts)
    const expectedTeamsInSession = totalTeams % 2 === 0 ? totalTeams : totalTeams - 1;
    if (teamsInSession.size !== expectedTeamsInSession) {
      issues.push({
        session: session.sessionNumber,
        issue: `Not all teams playing in session ${session.sessionNumber}`,
        teamsPlaying: teamsInSession.size,
        expectedTeams: expectedTeamsInSession,
        missingTeams: totalTeams - teamsInSession.size - (session.byeTeam ? 1 : 0)
      });
    }
  });
  
  // Validate complete round robin coverage
  const allMatchups = new Set();
  schedule.forEach(session => {
    session.matches.forEach(match => {
      const matchup = [match.homeTeam.id, match.awayTeam.id].sort().join('-');
      if (allMatchups.has(matchup)) {
        issues.push({
          issue: 'Duplicate matchup found',
          matchup: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
          sessions: schedule.filter(s => 
            s.matches.some(m => 
              [m.homeTeam.id, m.awayTeam.id].sort().join('-') === matchup
            )
          ).map(s => s.sessionNumber)
        });
      }
      allMatchups.add(matchup);
    });
  });
  
  const expectedMatchups = (totalTeams * (totalTeams - 1)) / 2;
  if (allMatchups.size !== expectedMatchups) {
    issues.push({
      issue: 'Incomplete round robin',
      actualMatchups: allMatchups.size,
      expectedMatchups,
      missing: expectedMatchups - allMatchups.size
    });
  }
  
  return issues;
};

// Helper function to convert snake_case to camelCase
const toCamelCase = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toCamelCase);
  if (obj instanceof Date) return obj;
  if (typeof obj !== 'object') return obj;

  const camelCaseObj = {};
  Object.keys(obj).forEach(key => {
    const camelKey = key.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
    camelCaseObj[camelKey] = toCamelCase(obj[key]);
  });
  return camelCaseObj;
  
};

module.exports = {
  generateRoundRobinSchedule,
  validateRoundRobinSchedule,
  findById,
  findByIndex,
  validateScore,
  validateEmail,
  toCamelCase
};