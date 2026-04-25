// controllers/scheduleController.js
// Session management, round-robin generation, schedule validation, and match retrieval.
const { query, withTransaction } = require('../config/database');
const { generateRoundRobinSchedule, validateRoundRobinSchedule, toCamelCase } = require('../utils/helpers');

const registerSessionToTournament = async (req, res) => {
  try {
    const { sessionNumber, sessionName, sessionDate, notes } = req.body;

    if (!sessionNumber || !sessionDate) {
      return res.status(400).json({ error: 'Session number and session date are required' });
    }

    await withTransaction(async (client) => {
      // Check if tournament exists
      const tournamentResult = await client.query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
      if (tournamentResult.rows.length === 0) {
        throw new Error('Tournament not found');
      }

      // Check if session number already exists for this tournament
      const existingResult = await client.query(
        'SELECT id FROM league_sessions WHERE tournament_id = $1 AND session_number = $2',
        [req.params.tournamentId, parseInt(sessionNumber)]
      );
      if (existingResult.rows.length > 0) {
        throw new Error('Session number already exists for this tournament');
      }

      // Create league session
      const result = await client.query(
        `INSERT INTO league_sessions (tournament_id, session_number, session_name, session_date, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [req.params.tournamentId, parseInt(sessionNumber), sessionName || `Session ${sessionNumber}`, new Date(sessionDate), notes || null]
      );

      res.status(201).json(toCamelCase(result.rows[0]));
    });
  } catch (error) {
    console.error('Error creating league session:', error);
    if (['Tournament not found', 'Session number already exists for this tournament'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create league session' });
  }
};

const getSessionsForTournament = async (req, res) => {
  try {
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Get sessions with match counts
    const sessionsResult = await query(
      `SELECT ls.*,
              COUNT(m.id) as match_count,
              COUNT(CASE WHEN m.status = 'completed' THEN 1 END) as completed_matches,
              COUNT(CASE WHEN m.status = 'scheduled' THEN 1 END) as scheduled_matches,
              COUNT(CASE WHEN m.status = 'in_progress' THEN 1 END) as in_progress_matches
       FROM league_sessions ls
       LEFT JOIN matches m ON ls.id = m.session_id
       WHERE ls.tournament_id = $1
       GROUP BY ls.id
       ORDER BY ls.session_number`,
      [req.params.tournamentId]
    );

    const enrichedSessions = sessionsResult.rows.map(session => ({
      ...toCamelCase(session),
      matchCount: parseInt(session.match_count),
      completedMatches: parseInt(session.completed_matches),
      scheduledMatches: parseInt(session.scheduled_matches),
      inProgressMatches: parseInt(session.in_progress_matches),
      isComplete: parseInt(session.match_count) > 0 && parseInt(session.completed_matches) === parseInt(session.match_count)
    }));

    res.json(enrichedSessions);
  } catch (error) {
    console.error('Error fetching tournament sessions:', error);
    res.status(500).json({ error: 'Failed to fetch tournament sessions' });
  }
};

const updateSessionStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!['scheduled', 'active', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await query(
      `UPDATE league_sessions SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'League session not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating session status:', error);
    res.status(500).json({ error: 'Failed to update session status' });
  }
};

const previewMatchMaking = async (req, res) => {
  try {
    const tournamentResult = await query('SELECT * FROM tournaments WHERE id = $1', [req.params.tournamentId]);
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    const tournament = tournamentResult.rows[0];

    // Get registered teams
    const teamsResult = await query(
      `SELECT tt.team_id, t.name, tt.seed_number
       FROM tournament_teams tt
       JOIN teams t ON tt.team_id = t.id
       WHERE tt.tournament_id = $1 AND tt.status = 'registered'
       ORDER BY tt.seed_number NULLS LAST, t.name`,
      [req.params.tournamentId]
    );

    if (teamsResult.rows.length < 2) {
      return res.status(400).json({
        error: 'At least 2 teams must be registered to generate round robin schedule'
      });
    }

    const registeredTeams = teamsResult.rows.map(row => ({
      id: row.team_id,
      name: row.name,
      seedNumber: row.seed_number
    }));

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
      sessionsAvailable: tournament.total_sessions,
      canFitInTournament: tournament.total_sessions >= sessionsRequired,
      totalMatches,
      expectedMatches,
      matchesPerTeam: registeredTeams.length - 1,
      matchesPerSession: hasOddTeams ? Math.floor(registeredTeams.length / 2) : registeredTeams.length / 2,
      teamsPerSession: hasOddTeams ? registeredTeams.length - 1 : registeredTeams.length,
      schedule: toCamelCase(schedule),
      validationIssues: toCamelCase(validationIssues),
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

const getTournamentSchedule = async (req, res) => {
  try {
    const tournamentResult = await query('SELECT * FROM tournaments WHERE id = $1', [req.params.tournamentId]);
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    const tournament = tournamentResult.rows[0];

    // Get tournament matches with team details
    const matchesResult = await query(
      `SELECT m.*, ht.name as home_team_name, at.name as away_team_name, ls.session_name
       FROM matches m
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at ON m.away_team_id = at.id
       LEFT JOIN league_sessions ls ON m.session_id = ls.id
       WHERE m.tournament_id = $1
       ORDER BY m.session_number NULLS LAST, m.created_at`,
      [req.params.tournamentId]
    );

    const tournamentMatches = matchesResult.rows;

    // Get tournament sessions
    const sessionsResult = await query(
      'SELECT * FROM league_sessions WHERE tournament_id = $1 ORDER BY session_number',
      [req.params.tournamentId]
    );
    const tournamentSessions = sessionsResult.rows;

    // Get registered teams
    const teamsResult = await query(
      `SELECT tt.*, t.name as team_name
       FROM tournament_teams tt
       JOIN teams t ON tt.team_id = t.id
       WHERE tt.tournament_id = $1 AND tt.status = 'registered'`,
      [req.params.tournamentId]
    );
    const registeredTeams = teamsResult.rows;

    // Group matches by session with team validation
    const sessionAnalysis = {};
    tournamentMatches.forEach(match => {
      const session = match.session_number || 'Unassigned';
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
      if (sessionData.teamsPlaying.has(match.home_team_id) || sessionData.teamsPlaying.has(match.away_team_id)) {
        sessionData.conflicts.push({
          matchId: match.id,
          matchName: `${match.home_team_name} vs ${match.away_team_name}`,
          conflictingTeams: [
            sessionData.teamsPlaying.has(match.home_team_id) ? match.home_team_name : null,
            sessionData.teamsPlaying.has(match.away_team_id) ? match.away_team_name : null
          ].filter(Boolean)
        });
      }

      sessionData.teamsPlaying.add(match.home_team_id);
      sessionData.teamsPlaying.add(match.away_team_id);
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
        matches: sessionAnalysis[session].matches.map(match => ({
          id: match.id,
          homeTeam: { id: match.home_team_id, name: match.home_team_name },
          awayTeam: { id: match.away_team_id, name: match.away_team_name },
          status: match.status,
          matchDate: match.match_date,
          matchName: match.match_name
        }))
      })),
      hasScheduleConflicts: Object.values(sessionAnalysis).some(sa => sa.conflicts.length > 0),
      overallValidation: {
        allTeamsPlayingPerSession: Object.values(sessionAnalysis).every(sa =>
          sa.teamsPlaying.size === (registeredTeams.length % 2 === 0 ? registeredTeams.length : registeredTeams.length - 1)
        ),
        noTeamConflicts: Object.values(sessionAnalysis).every(sa => sa.conflicts.length === 0),
        completeRoundRobin: isCompleteRoundRobin
      },
      sessions: toCamelCase(tournamentSessions.sort((a, b) => a.session_number - b.session_number))
    };

    res.json(summary);
  } catch (error) {
    console.error('Error getting schedule summary:', error);
    res.status(500).json({ error: 'Failed to get schedule summary' });
  }
};

const validateTournamentSchedule = async (req, res) => {
  try {
    const tournamentResult = await query('SELECT * FROM tournaments WHERE id = $1', [req.params.tournamentId]);
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Get tournament matches
    const matchesResult = await query(
      'SELECT * FROM matches WHERE tournament_id = $1',
      [req.params.tournamentId]
    );
    const tournamentMatches = matchesResult.rows;

    // Get registered teams
    const teamsResult = await query(
      'SELECT team_id FROM tournament_teams WHERE tournament_id = $1 AND status = $2',
      [req.params.tournamentId, 'registered']
    );
    const registeredTeams = teamsResult.rows;
    const totalTeams = registeredTeams.length;

    const validationResults = {
      tournamentId: req.params.tournamentId,
      totalTeams,
      totalMatches: tournamentMatches.length,
      issues: [],
      warnings: [],
      isValid: true
    };

    // Validate basic requirements
    if (totalTeams < 2) {
      validationResults.issues.push({
        type: 'INSUFFICIENT_TEAMS',
        message: 'Tournament needs at least 2 teams',
        teams: totalTeams
      });
      validationResults.isValid = false;
    }

    // Validate match count for complete round robin
    const expectedMatches = (totalTeams * (totalTeams - 1)) / 2;
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
      const session = match.session_number || 'unassigned';
      if (!sessionGroups[session]) {
        sessionGroups[session] = {
          matches: [],
          teams: new Set()
        };
      }
      sessionGroups[session].matches.push(match);
      sessionGroups[session].teams.add(match.home_team_id);
      sessionGroups[session].teams.add(match.away_team_id);
    });

    const expectedTeamsPerSession = totalTeams % 2 === 0 ? totalTeams : totalTeams - 1;

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
        teamMatchCount[match.home_team_id] = (teamMatchCount[match.home_team_id] || 0) + 1;
        teamMatchCount[match.away_team_id] = (teamMatchCount[match.away_team_id] || 0) + 1;
      });

      Object.keys(teamMatchCount).forEach(async (teamId) => {
        if (teamMatchCount[teamId] > 1) {
          const teamResult = await query('SELECT name FROM teams WHERE id = $1', [teamId]);
          const teamName = teamResult.rows[0]?.name || teamId;
          validationResults.issues.push({
            type: 'TEAM_CONFLICT',
            message: `Team ${teamName} plays ${teamMatchCount[teamId]} matches in session ${sessionKey}`,
            session: sessionKey,
            teamId,
            teamName,
            matchCount: teamMatchCount[teamId]
          });
          validationResults.isValid = false;
        }
      });
    });

    // Validate matchup uniqueness
    const allMatchups = new Set();
    const duplicateMatchups = [];

    tournamentMatches.forEach(async (match) => {
      const matchup = [match.home_team_id, match.away_team_id].sort().join('-');
      if (allMatchups.has(matchup)) {
        const homeTeamResult = await query('SELECT name FROM teams WHERE id = $1', [match.home_team_id]);
        const awayTeamResult = await query('SELECT name FROM teams WHERE id = $1', [match.away_team_id]);
        duplicateMatchups.push({
          matchup: `${homeTeamResult.rows[0]?.name || 'Unknown'} vs ${awayTeamResult.rows[0]?.name || 'Unknown'}`,
          homeTeamId: match.home_team_id,
          awayTeamId: match.away_team_id
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

    // Add warnings for potential issues
    const expectedSessions = totalTeams - 1;
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

const getRoundMatches = async (req, res) => {
  try {
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const sessionNumber = parseInt(req.params.sessionNumber);

    // Get matches for the specific session
    const matchesResult = await query(
      `SELECT m.*, ht.name as home_team_name, at.name as away_team_name, wt.name as winner_team_name
       FROM matches m
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at ON m.away_team_id = at.id
       LEFT JOIN teams wt ON m.winner_team_id = wt.id
       WHERE m.tournament_id = $1 AND m.session_number = $2
       ORDER BY m.created_at`,
      [req.params.tournamentId, sessionNumber]
    );
    const sessionMatches = matchesResult.rows;

    // Get registered teams count for validation
    const teamsResult = await query(
      'SELECT team_id FROM tournament_teams WHERE tournament_id = $1 AND status = $2',
      [req.params.tournamentId, 'registered']
    );
    const registeredTeams = teamsResult.rows;

    // Validate session: no team plays twice, all teams play (except bye)
    const teamsInSession = new Set();
    const conflicts = [];

    sessionMatches.forEach(match => {
      if (teamsInSession.has(match.home_team_id) || teamsInSession.has(match.away_team_id)) {
        conflicts.push({
          matchId: match.id,
          homeTeam: match.home_team_name,
          awayTeam: match.away_team_name,
          conflictingTeams: [
            teamsInSession.has(match.home_team_id) ? match.home_team_name : null,
            teamsInSession.has(match.away_team_id) ? match.away_team_name : null
          ].filter(Boolean)
        });
      }
      teamsInSession.add(match.home_team_id);
      teamsInSession.add(match.away_team_id);
    });

    // Determine which team has bye (if any)
    let byeTeam = null;
    if (registeredTeams.length % 2 === 1) {
      const allTeamIds = registeredTeams.map(t => t.team_id);
      const playingTeamIds = Array.from(teamsInSession);
      const byeTeamId = allTeamIds.find(id => !playingTeamIds.includes(id));
      if (byeTeamId) {
        const byeTeamResult = await query('SELECT id, name FROM teams WHERE id = $1', [byeTeamId]);
        if (byeTeamResult.rows.length > 0) {
          byeTeam = byeTeamResult.rows[0];
        }
      }
    }

    // Enrich matches with team details
    const enrichedMatches = sessionMatches.map(match => ({
      ...toCamelCase(match),
      homeTeamDetails: {
        id: match.home_team_id,
        name: match.home_team_name
      },
      awayTeamDetails: {
        id: match.away_team_id,
        name: match.away_team_name
      }
    }));

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

const getAllMatchesForTournament = async (req, res) => {
  try {
    const tournamentResult = await query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const matchesResult = await query(
      `SELECT m.*, ht.name as home_team_name, at.name as away_team_name, wt.name as winner_team_name,
              ls.session_name, ls.session_date
       FROM matches m
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at ON m.away_team_id = at.id
       LEFT JOIN teams wt ON m.winner_team_id = wt.id
       LEFT JOIN league_sessions ls ON m.session_id = ls.id
       WHERE m.tournament_id = $1
       ORDER BY m.session_number NULLS LAST, m.match_date NULLS LAST, m.created_at`,
      [req.params.tournamentId]
    );

    const enrichedMatches = matchesResult.rows.map(match => ({
      ...toCamelCase(match),
      homeTeamDetails: {
        id: match.home_team_id,
        name: match.home_team_name
      },
      awayTeamDetails: {
        id: match.away_team_id,
        name: match.away_team_name
      },
      winnerTeamDetails: match.winner_team_id ? {
        id: match.winner_team_id,
        name: match.winner_team_name
      } : null,
      sessionDetails: match.session_id ? {
        id: match.session_id,
        name: match.session_name,
        date: match.session_date
      } : null
    }));

    res.json(enrichedMatches);
  } catch (error) {
    console.error('Error fetching tournament matches:', error);
    res.status(500).json({ error: 'Failed to fetch tournament matches' });
  }
};

const deleteTournamentSchedule = async (req, res) => {
  try {
    await withTransaction(async (client) => {
      const tournamentResult = await client.query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
      if (tournamentResult.rows.length === 0) {
        throw new Error('Tournament not found');
      }

      // Get tournament matches
      const matchesResult = await client.query(
        'SELECT id FROM matches WHERE tournament_id = $1',
        [req.params.tournamentId]
      );
      const matchIds = matchesResult.rows.map(row => row.id);

      // Check if any matches have recorded scores
      if (matchIds.length > 0) {
        const scoresResult = await client.query(
          'SELECT COUNT(*) FROM scores WHERE match_id = ANY($1)',
          [matchIds]
        );

        if (parseInt(scoresResult.rows[0].count) > 0) {
          throw new Error('Cannot clear schedule - some matches have recorded scores. Delete scores first.');
        }
      }

      // Remove all matches for this tournament
      const removedMatchesResult = await client.query(
        'DELETE FROM matches WHERE tournament_id = $1 RETURNING id',
        [req.params.tournamentId]
      );
      const removedMatchCount = removedMatchesResult.rows.length;

      // Remove auto-generated sessions (those with notes containing "Automatically generated")
      const removedSessionsResult = await client.query(
        `DELETE FROM league_sessions
         WHERE tournament_id = $1 AND notes LIKE '%Automatically generated%'
         RETURNING id`,
        [req.params.tournamentId]
      );
      const removedSessionCount = removedSessionsResult.rows.length;

      res.json({
        message: 'Tournament schedule cleared successfully',
        removedMatches: removedMatchCount,
        removedSessions: removedSessionCount
      });
    });
  } catch (error) {
    console.error('Error clearing schedule:', error);
    if (['Tournament not found', 'Cannot clear schedule - some matches have recorded scores. Delete scores first.'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to clear tournament schedule' });
  }
};

const generateMatches = async (req, res) => {
  try {
    const { startDate = null, daysBetweenSessions = 7, overrideTeamOrder = null, forceCreate = false } = req.body;

    await withTransaction(async (client) => {
      // Check if tournament exists
      const tournamentResult = await client.query('SELECT * FROM tournaments WHERE id = $1', [req.params.tournamentId]);
      if (tournamentResult.rows.length === 0) {
        throw new Error('Tournament not found');
      }
      const tournament = tournamentResult.rows[0];

      // Check if tournament already has matches
      const existingMatchesResult = await client.query(
        'SELECT COUNT(*) FROM matches WHERE tournament_id = $1',
        [req.params.tournamentId]
      );
      if (parseInt(existingMatchesResult.rows[0].count) > 0) {
        throw new Error('Tournament already has scheduled matches. Delete existing matches first.');
      }

      // Get registered teams
      const teamsResult = await client.query(
        `SELECT tt.team_id, t.name, tt.seed_number
         FROM tournament_teams tt
         JOIN teams t ON tt.team_id = t.id
         WHERE tt.tournament_id = $1 AND tt.status = 'registered'
         ORDER BY tt.seed_number NULLS LAST, t.name`,
        [req.params.tournamentId]
      );

      if (teamsResult.rows.length < 2) {
        throw new Error('At least 2 teams must be registered to generate round robin schedule');
      }

      let registeredTeams = teamsResult.rows.map(row => ({
        id: row.team_id,
        name: row.name,
        seedNumber: row.seed_number
      }));

      // Generate round robin schedule
      const schedule = generateRoundRobinSchedule(registeredTeams);
      const sessionsRequired = schedule.length;

      // Validate schedule
      const validationIssues = validateRoundRobinSchedule(schedule, registeredTeams.length);

      if (validationIssues.length > 0 && !forceCreate) {
        return res.status(400).json({
          error: 'Schedule validation failed. Use forceCreate=true to override.',
          validationIssues: toCamelCase(validationIssues),
          schedule: toCamelCase(schedule)
        });
      }

      // Calculate session dates
      const baseDate = startDate ? new Date(startDate) : new Date(tournament.start_date);
      const sessionDates = [];
      for (let i = 0; i < sessionsRequired; i++) {
        const sessionDate = new Date(baseDate);
        sessionDate.setDate(baseDate.getDate() + (i * daysBetweenSessions));
        sessionDates.push(sessionDate);
      }

      // Create sessions and matches
      const createdMatches = [];
      const createdSessions = [];

      for (let sessionIndex = 0; sessionIndex < schedule.length; sessionIndex++) {
        const session = schedule[sessionIndex];
        const sessionDate = sessionDates[sessionIndex];

        // Create session if it doesn't exist
        const sessionResult = await client.query(
          `INSERT INTO league_sessions (tournament_id, session_number, session_name, session_date, notes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tournament_id, session_number) DO UPDATE SET
           session_date = EXCLUDED.session_date,
           notes = EXCLUDED.notes
           RETURNING *`,
          [
            req.params.tournamentId,
            session.sessionNumber,
            `Round Robin Session ${session.sessionNumber}`,
            sessionDate,
            `Automatically generated round robin session - ${session.matches.length} matches`
          ]
        );

        const sessionRecord = sessionResult.rows[0];
        createdSessions.push(toCamelCase(sessionRecord));

        // Create matches for this session
        for (let matchIndex = 0; matchIndex < session.matches.length; matchIndex++) {
          const match = session.matches[matchIndex];

          const matchResult = await client.query(
            `INSERT INTO matches (tournament_id, home_team_id, away_team_id, session_id, session_number, match_date, match_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
              req.params.tournamentId,
              match.homeTeam.id,
              match.awayTeam.id,
              sessionRecord.id,
              session.sessionNumber,
              sessionDate,
              `Session ${session.sessionNumber} - ${match.homeTeam.name} vs ${match.awayTeam.name}`
            ]
          );

          createdMatches.push(toCamelCase(matchResult.rows[0]));
        }
      }

      // Update tournament sessions count if needed
      if (tournament.total_sessions < sessionsRequired) {
        await client.query(
          'UPDATE tournaments SET total_sessions = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [sessionsRequired, req.params.tournamentId]
        );
      }

      const result = {
        tournamentId: req.params.tournamentId,
        totalMatchesCreated: createdMatches.length,
        totalSessionsCreated: createdSessions.length,
        totalTeams: registeredTeams.length,
        sessionsRequired,
        validationIssues: toCamelCase(validationIssues),
        wasForced: validationIssues.length > 0 && forceCreate,
        schedule: toCamelCase(schedule),
        createdMatches,
        createdSessions
      };

      res.status(201).json(result);
    });
  } catch (error) {
    console.error('Error creating round robin matches:', error);
    if (['Tournament not found', 'Tournament already has scheduled matches. Delete existing matches first.', 'At least 2 teams must be registered to generate round robin schedule'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create round robin schedule' });
  }
};

module.exports = {
  registerSessionToTournament,
  getSessionsForTournament,
  updateSessionStatus,
  previewMatchMaking,
  generateMatches,
  getTournamentSchedule,
  deleteTournamentSchedule,
  validateTournamentSchedule,
  getRoundMatches,
  getAllMatchesForTournament
};
