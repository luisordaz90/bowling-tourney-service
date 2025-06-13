// controllers/matchesController.js
const { query, withTransaction } = require('../config/database');

const getMatchById = async (req, res) => {
  try {
    const result = await query(
      `SELECT m.*, ht.name as home_team_name, at.name as away_team_name, wt.name as winner_team_name,
              ls.session_name, t.name as tournament_name
       FROM matches m
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at ON m.away_team_id = at.id
       LEFT JOIN teams wt ON m.winner_team_id = wt.id
       LEFT JOIN league_sessions ls ON m.session_id = ls.id
       JOIN tournaments t ON m.tournament_id = t.id
       WHERE m.id = $1`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    const match = result.rows[0];
    const enrichedMatch = {
      ...match,
      homeTeamName: match.home_team_name,
      awayTeamName: match.away_team_name,
      winnerTeamName: match.winner_team_name,
      sessionName: match.session_name,
      tournamentName: match.tournament_name
    };
    
    res.json(enrichedMatch);
  } catch (error) {
    console.error('Error fetching match:', error);
    res.status(500).json({ error: 'Failed to fetch match' });
  }
};

const updateMatchStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['scheduled', 'in_progress', 'completed', 'cancelled', 'postponed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await query(
      `UPDATE matches SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating match status:', error);
    res.status(500).json({ error: 'Failed to update match status' });
  }
};

const addPlayerScoreInMatch = async (req, res) => {
  try {
    const { teamId, playerId, game1Score, game2Score, game3Score, handicapApplied } = req.body;
    
    if (!teamId || !playerId || game1Score === undefined || game2Score === undefined || game3Score === undefined) {
      return res.status(400).json({ error: 'Team ID, Player ID, and all three game scores are required' });
    }

    // Validate scores (0-300 for each game)
    const games = [game1Score, game2Score, game3Score];
    if (games.some(score => score < 0 || score > 300)) {
      return res.status(400).json({ error: 'Game scores must be between 0 and 300' });
    }

    await withTransaction(async (client) => {
      // Verify match exists
      const matchResult = await client.query('SELECT * FROM matches WHERE id = $1', [req.params.matchId]);
      if (matchResult.rows.length === 0) {
        throw new Error('Match not found');
      }
      const match = matchResult.rows[0];

      // Verify team is part of the match
      if (teamId !== match.home_team_id && teamId !== match.away_team_id) {
        throw new Error('Team is not part of this match');
      }

      // Verify player exists
      const playerResult = await client.query('SELECT id FROM players WHERE id = $1', [playerId]);
      if (playerResult.rows.length === 0) {
        throw new Error('Player not found');
      }

      // Check if score already exists for this player in this match
      const existingScoreResult = await client.query(
        'SELECT id FROM player_match_scores WHERE match_id = $1 AND player_id = $2',
        [req.params.matchId, playerId]
      );
      if (existingScoreResult.rows.length > 0) {
        throw new Error('Score already recorded for this player in this match');
      }

      // Insert player match score
      const scoreResult = await client.query(
        `INSERT INTO player_match_scores (match_id, team_id, player_id, game1_score, game2_score, game3_score, handicap_applied)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.params.matchId, teamId, playerId, game1Score, game2Score, game3Score, handicapApplied || 0]
      );

      // Update player statistics
      const totalScore = game1Score + game2Score + game3Score;
      await client.query(
        `UPDATE players 
         SET total_games_played = total_games_played + 3,
             total_pins = total_pins + $1,
             average_score = CASE 
               WHEN total_games_played + 3 > 0 
               THEN ROUND((total_pins + $1)::DECIMAL / (total_games_played + 3), 2)
               ELSE 0 
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [totalScore, playerId]
      );

      res.status(201).json(scoreResult.rows[0]);
    });
  } catch (error) {
    console.error('Error recording player match score:', error);
    
    if (['Match not found', 'Team is not part of this match', 'Player not found', 'Score already recorded for this player in this match'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to record player match score' });
  }
};

const getPlayersMatchScore = async (req, res) => {
  try {
    const result = await query(
      `SELECT pms.*, p.name as player_name, t.name as team_name
       FROM player_match_scores pms
       JOIN players p ON pms.player_id = p.id
       JOIN teams t ON pms.team_id = t.id
       WHERE pms.match_id = $1
       ORDER BY t.name, p.name`,
      [req.params.matchId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching player match scores:', error);
    res.status(500).json({ error: 'Failed to fetch player match scores' });
  }
};

const addTeamScoreInMatch = async (req, res) => {
  try {
    const { teamId } = req.body;
    
    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    await withTransaction(async (client) => {
      // Verify match exists
      const matchResult = await client.query('SELECT * FROM matches WHERE id = $1', [req.params.matchId]);
      if (matchResult.rows.length === 0) {
        throw new Error('Match not found');
      }
      const match = matchResult.rows[0];

      // Verify team is part of the match
      if (teamId !== match.home_team_id && teamId !== match.away_team_id) {
        throw new Error('Team is not part of this match');
      }

      // Check if team score already exists
      const existingTeamScoreResult = await client.query(
        'SELECT id FROM team_match_scores WHERE match_id = $1 AND team_id = $2',
        [req.params.matchId, teamId]
      );
      if (existingTeamScoreResult.rows.length > 0) {
        throw new Error('Team score already recorded for this match');
      }

      // Calculate team scores from player scores
      const playerScoresResult = await client.query(
        `SELECT game1_score + game2_score + game3_score as total_score, handicap_applied
         FROM player_match_scores 
         WHERE match_id = $1 AND team_id = $2`,
        [req.params.matchId, teamId]
      );

      if (playerScoresResult.rows.length === 0) {
        throw new Error('No player scores found for this team in this match');
      }

      const totalTeamScore = playerScoresResult.rows.reduce((sum, row) => sum + row.total_score, 0);
      const totalHandicap = playerScoresResult.rows.reduce((sum, row) => sum + row.handicap_applied, 0);
      const gamesPlayed = playerScoresResult.rows.length * 3;
      const teamAverage = parseFloat((totalTeamScore / gamesPlayed).toFixed(2));

      // Insert team match score
      const teamScoreResult = await client.query(
        `INSERT INTO team_match_scores (match_id, team_id, total_team_score, total_handicap, team_average, games_played)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [req.params.matchId, teamId, totalTeamScore, totalHandicap, teamAverage, gamesPlayed]
      );

      res.status(201).json(teamScoreResult.rows[0]);
    });
  } catch (error) {
    console.error('Error recording team match score:', error);
    
    if (['Match not found', 'Team is not part of this match', 'Team score already recorded for this match', 'No player scores found for this team in this match'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to record team match score' });
  }
};

const getTeamsScoreInMatch = async (req, res) => {
  try {
    const result = await query(
      `SELECT tms.*, t.name as team_name
       FROM team_match_scores tms
       JOIN teams t ON tms.team_id = t.id
       WHERE tms.match_id = $1
       ORDER BY t.name`,
      [req.params.matchId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching team match scores:', error);
    res.status(500).json({ error: 'Failed to fetch team match scores' });
  }
};

const createMatch = async (req, res) => {
  try {
    const { homeTeamId, awayTeamId, sessionId, sessionNumber, matchDate, matchName } = req.body;
    
    if (!homeTeamId || !awayTeamId) {
      return res.status(400).json({ error: 'Home team ID and away team ID are required' });
    }

    if (homeTeamId === awayTeamId) {
      return res.status(400).json({ error: 'Home team and away team cannot be the same' });
    }

    await withTransaction(async (client) => {
      // Verify tournament exists
      const tournamentResult = await client.query('SELECT id FROM tournaments WHERE id = $1', [req.params.tournamentId]);
      if (tournamentResult.rows.length === 0) {
        throw new Error('Tournament not found');
      }

      // Verify both teams are registered in the tournament
      const homeTeamResult = await client.query(
        'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
        [req.params.tournamentId, homeTeamId]
      );
      const awayTeamResult = await client.query(
        'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
        [req.params.tournamentId, awayTeamId]
      );

      if (homeTeamResult.rows.length === 0 || awayTeamResult.rows.length === 0) {
        throw new Error('Both teams must be registered in the tournament');
      }

      // Create the match
      const matchResult = await client.query(
        `INSERT INTO matches (tournament_id, home_team_id, away_team_id, session_id, session_number, match_date, match_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.params.tournamentId, homeTeamId, awayTeamId, sessionId || null, sessionNumber || null, matchDate ? new Date(matchDate) : null, matchName || null]
      );

      res.status(201).json(matchResult.rows[0]);
    });
  } catch (error) {
    console.error('Error creating match:', error);
    
    if (['Tournament not found', 'Both teams must be registered in the tournament'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to create match' });
  }
};

const calculateTeamScoreInMatch = async (req, res) => {
  try {
    const { teamId } = req.body;
    
    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    await withTransaction(async (client) => {
      // Verify match exists
      const matchResult = await client.query('SELECT * FROM matches WHERE id = $1', [req.params.matchId]);
      if (matchResult.rows.length === 0) {
        throw new Error('Match not found');
      }
      const match = matchResult.rows[0];

      // Verify team is part of the match
      if (teamId !== match.home_team_id && teamId !== match.away_team_id) {
        throw new Error('Team is not part of this match');
      }

      // Check if team score already exists
      const existingTeamScoreResult = await client.query(
        'SELECT id FROM team_match_scores WHERE match_id = $1 AND team_id = $2',
        [req.params.matchId, teamId]
      );
      
      let teamMatchScore;
      
      // Calculate team scores from player scores
      const playerScoresResult = await client.query(
        `SELECT game1_score + game2_score + game3_score as total_score, handicap_applied
         FROM player_match_scores 
         WHERE match_id = $1 AND team_id = $2`,
        [req.params.matchId, teamId]
      );

      if (playerScoresResult.rows.length === 0) {
        throw new Error('No player scores found for this team in this match');
      }

      const totalTeamScore = playerScoresResult.rows.reduce((sum, row) => sum + row.total_score, 0);
      const totalHandicap = playerScoresResult.rows.reduce((sum, row) => sum + row.handicap_applied, 0);
      const gamesPlayed = playerScoresResult.rows.length * 3;
      const teamAverage = parseFloat((totalTeamScore / gamesPlayed).toFixed(2));

      if (existingTeamScoreResult.rows.length > 0) {
        // Update existing team score
        const updateResult = await client.query(
          `UPDATE team_match_scores 
           SET total_team_score = $1, total_handicap = $2, team_average = $3, games_played = $4, recorded_at = CURRENT_TIMESTAMP
           WHERE match_id = $5 AND team_id = $6
           RETURNING *`,
          [totalTeamScore, totalHandicap, teamAverage, gamesPlayed, req.params.matchId, teamId]
        );
        teamMatchScore = updateResult.rows[0];
      } else {
        // Insert new team match score
        const insertResult = await client.query(
          `INSERT INTO team_match_scores (match_id, team_id, total_team_score, total_handicap, team_average, games_played)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [req.params.matchId, teamId, totalTeamScore, totalHandicap, teamAverage, gamesPlayed]
        );
        teamMatchScore = insertResult.rows[0];
      }

      // Check if both teams have scores recorded
      const bothTeamsScoresResult = await client.query(
        'SELECT COUNT(*) FROM team_match_scores WHERE match_id = $1',
        [req.params.matchId]
      );

      // If both teams have scores, determine winner and update match
      if (parseInt(bothTeamsScoresResult.rows[0].count) === 2) {
        const allTeamScoresResult = await client.query(
          `SELECT team_id, total_team_score + total_handicap as final_score
           FROM team_match_scores 
           WHERE match_id = $1
           ORDER BY (total_team_score + total_handicap) DESC`,
          [req.params.matchId]
        );

        const teamScores = allTeamScoresResult.rows;
        
        // Determine winner (highest score wins)
        let winnerTeamId = null;
        if (teamScores.length === 2) {
          if (teamScores[0].final_score > teamScores[1].final_score) {
            winnerTeamId = teamScores[0].team_id;
          } else if (teamScores[1].final_score > teamScores[0].final_score) {
            winnerTeamId = teamScores[1].team_id;
          }
          // If scores are tied, winner remains null (tie game)
        }

        // Update match with winner and status
        await client.query(
          `UPDATE matches 
           SET winner_team_id = $1, status = 'completed', updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [winnerTeamId, req.params.matchId]
        );

        // Update team statistics
        for (const teamScore of teamScores) {
          const isWinner = teamScore.team_id === winnerTeamId;
          const isLoser = winnerTeamId && teamScore.team_id !== winnerTeamId;

          await client.query(
            `INSERT INTO team_statistics (team_id, tournament_id, total_matches_played, matches_won, matches_lost, total_team_score, team_average)
             VALUES ($1, $2, 1, $3, $4, $5, $6)
             ON CONFLICT (team_id, tournament_id)
             DO UPDATE SET
               total_matches_played = team_statistics.total_matches_played + 1,
               matches_won = team_statistics.matches_won + $3,
               matches_lost = team_statistics.matches_lost + $4,
               total_team_score = team_statistics.total_team_score + $5,
               team_average = CASE 
                 WHEN (team_statistics.total_matches_played + 1) > 0 
                 THEN ROUND((team_statistics.total_team_score + $5) / (team_statistics.total_matches_played + 1), 2)
                 ELSE 0 
               END,
               last_updated = CURRENT_TIMESTAMP`,
            [teamScore.team_id, match.tournament_id, isWinner ? 1 : 0, isLoser ? 1 : 0, teamScore.final_score, teamScore.final_score]
          );
        }
      }

      res.status(existingTeamScoreResult.rows.length > 0 ? 200 : 201).json({
        ...teamMatchScore,
        matchCompleted: parseInt(bothTeamsScoresResult.rows[0].count) === 2,
        message: existingTeamScoreResult.rows.length > 0 ? 'Team score updated successfully' : 'Team score calculated successfully'
      });
    });
  } catch (error) {
    console.error('Error calculating team match score:', error);
    
    if (['Match not found', 'Team is not part of this match', 'No player scores found for this team in this match'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to calculate team match score' });
  }
};

const getMatchesByTournament = async (req, res) => {
  try {
    const result = await query(
      `SELECT m.*, ht.name as home_team_name, at.name as away_team_name, wt.name as winner_team_name,
              ls.session_name
       FROM matches m
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at ON m.away_team_id = at.id
       LEFT JOIN teams wt ON m.winner_team_id = wt.id
       LEFT JOIN league_sessions ls ON m.session_id = ls.id
       WHERE m.tournament_id = $1
       ORDER BY m.session_number NULLS LAST, m.match_date NULLS LAST, m.created_at`,
      [req.params.tournamentId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tournament matches:', error);
    res.status(500).json({ error: 'Failed to fetch tournament matches' });
  }
};

module.exports = {
  getMatchById,
  updateMatchStatus,
  addPlayerScoreInMatch,
  getPlayersMatchScore,
  addTeamScoreInMatch,
  getTeamsScoreInMatch,
  calculateTeamScoreInMatch,
  createMatch,
  getMatchesByTournament
};