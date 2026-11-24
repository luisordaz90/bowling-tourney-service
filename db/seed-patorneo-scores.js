#!/usr/bin/env node
// db/seed-patorneo-scores.js
// Seeds tournament scores from tournament_results.json into the DB.
// Requires seed-patorneo.js to have been run first (teams, players, tournament).
//
// Usage: node db/seed-patorneo-scores.js

require('dotenv').config({ path: './.env.local' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:example@localhost:5432/bowling-tourney',
});

// ── JSON data ────────────────────────────────────────────────────────────────

const resultsPath = path.resolve(__dirname, '..', '..', '..', 'Desktop', 'tournament_results.json');
const data = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

// ── pdfId → name from seed-patorneo.js TEAMS ────────────────────────────────

const TEAMS_PDF = [
  { name: 'LAS COMADRES', players: [
    { name: 'Marco Contreras', pdfId: 98 }, { name: 'Alex Rodriguez', pdfId: 56 },
    { name: 'Itzayana Escamilla', pdfId: 57 }, { name: 'Rebeca Espinosa', pdfId: 52 },
    { name: 'Ismael', pdfId: 120 }, { name: 'Mauricio Aguilar', pdfId: 53 },
  ]},
  { name: 'CHARROS', players: [
    { name: 'Alvaro Na', pdfId: 15 }, { name: 'Carlos Serros', pdfId: 13 },
    { name: 'Hugo Brihuega', pdfId: 16 }, { name: 'Julio Villanueva', pdfId: 14 },
    { name: 'JESSI SOTO', pdfId: 103 }, { name: 'AGUSTINA CEBALLOS', pdfId: 18 },
  ]},
  { name: 'LOS PIOJOS', players: [
    { name: 'Hugo Montes', pdfId: 73 }, { name: 'Sergio Loyola', pdfId: 74 },
    { name: 'Carlos Montes', pdfId: 71 }, { name: 'Roberto sanchez', pdfId: 72 },
    { name: 'ERIK LOPEZ', pdfId: 104 }, { name: 'Tono Ruiz', pdfId: 75 },
    { name: 'Hugo Lopez', pdfId: 76 },
  ]},
  { name: 'ELLAS Y EL', players: [
    { name: 'POLO JR', pdfId: 68 }, { name: 'EMILIO GALINDO', pdfId: 67 },
    { name: 'ADREA CUERVO', pdfId: 65 }, { name: 'BENJAMIN RAMIREZ', pdfId: 69 },
    { name: 'MARU MARTINEZ', pdfId: 66 },
  ]},
  { name: 'LOBOS', players: [
    { name: 'Juan Manuel Padilla', pdfId: 20 }, { name: 'Alex Padilla', pdfId: 21 },
    { name: 'Kuko Comparan', pdfId: 23 }, { name: 'Ricardo Garcia', pdfId: 19 },
    { name: 'Jorge Padilla', pdfId: 24 },
  ]},
  { name: 'LA PANDILLA', players: [
    { name: 'SERGIO ESQUIVEL', pdfId: 92 }, { name: 'ENRIQE ESQUIVEL', pdfId: 110 },
    { name: 'Julio Cesar Plascencia', pdfId: 79 }, { name: 'ISRAEL', pdfId: 78 },
    { name: 'JORGE', pdfId: 80 }, { name: 'Miguel Moya', pdfId: 99 },
  ]},
  { name: '800 PLUS', players: [
    { name: 'Benjamin Martinez', pdfId: 37 }, { name: 'LUIS DANIEL VARELA', pdfId: 38 },
    { name: 'Charly Ayala', pdfId: 41 }, { name: 'MANUEL ALVARADO', pdfId: 121 },
    { name: 'Oswaldo de Luna', pdfId: 42 }, { name: 'Francisco Ruvalcaba', pdfId: 39 },
  ]},
  { name: 'BOLICHE GDL', players: [
    { name: 'BETO', pdfId: 32 }, { name: 'ALFONSO', pdfId: 33 },
    { name: 'ANDRES', pdfId: 31 }, { name: 'FABRIZZIO', pdfId: 35 },
    { name: 'HUGO MEZA', pdfId: 55 },
  ]},
  { name: 'PIN PALS', players: [
    { name: 'Fer Costa', pdfId: 63 }, { name: 'Andres Carrasco', pdfId: 61 },
    { name: 'Luis Ordaz', pdfId: 60 }, { name: 'Mundo Pineda', pdfId: 62 },
    { name: 'Cipriano Pineda', pdfId: 64 }, { name: 'IRVING SANDOVAL', pdfId: 59 },
  ]},
  { name: 'PIN 8', players: [
    { name: 'DAVID ROJAS', pdfId: 43 }, { name: 'CARLOS LARIOS', pdfId: 45 },
    { name: 'ALEJANDRO RUBIO', pdfId: 44 },
  ]},
  { name: 'BUSTER LEGION', players: [
    { name: 'Miguel Torres', pdfId: 97 }, { name: 'Arturo Cepeda', pdfId: 95 },
    { name: 'Carlos Hernandez', pdfId: 102 }, { name: 'Lupita Lopez', pdfId: 96 },
    { name: 'Luis Carlos', pdfId: 93 }, { name: 'LUIS JR', pdfId: 94 },
  ]},
  { name: 'HARD TEAM', players: [
    { name: 'Alexis Ramirez', pdfId: 83 }, { name: 'Murphy Ortiz', pdfId: 85 },
    { name: 'Victor Badillo', pdfId: 84 }, { name: 'Juan Ramirez', pdfId: 81 },
    { name: 'Emmanuel Gonzalez', pdfId: 82 },
  ]},
  { name: 'PAPIS TEAM', players: [
    { name: 'JOSE LUIS MARTINEZ', pdfId: 3 }, { name: 'JAVIER LARIOS', pdfId: 1 },
    { name: 'MAX MARTINEZ', pdfId: 2 }, { name: 'MARCO', pdfId: 6 },
    { name: 'LUIS GUILLERMO ESTRADA', pdfId: 5 }, { name: 'SCARLETT PADILLA', pdfId: 4 },
  ]},
  { name: 'LOS AZTECAS', players: [
    { name: 'GONZALO PALACIOS', pdfId: 89 }, { name: 'RENE ROSAS PIPE', pdfId: 91 },
    { name: 'ROGELIO', pdfId: 105 }, { name: 'MARIO GOMEZ', pdfId: 87 },
    { name: 'FELIPE DOMINGUEZ', pdfId: 88 }, { name: 'ANGEL FAUSTO', pdfId: 90 },
  ]},
  { name: 'AUTOMOTRIZ DEL AHORRO', players: [
    { name: 'Omar Aguirre', pdfId: 25 }, { name: 'Jair Moreno', pdfId: 28 },
    { name: 'Jonathan Moreno', pdfId: 29 }, { name: 'Mauricio Aguirre', pdfId: 26 },
    { name: 'OMAR AGUIRRE JR', pdfId: 30 }, { name: 'BETO MORENO', pdfId: 36 },
    { name: 'Patricia Moreno', pdfId: 27 },
  ]},
  { name: 'PANZER DIVISION', players: [
    { name: 'Angel Murga', pdfId: 9 }, { name: 'MIGUEL OROZCO', pdfId: 11 },
    { name: 'Juan Pablo Poblano', pdfId: 10 }, { name: 'Jorge Ortiz', pdfId: 12 },
    { name: 'Alvaro Chaves', pdfId: 7 },
  ]},
];

// ── Name-based fallback for players without pdfId in JSON ───────────────────

const NAME_TO_PDF_ID = {
  'Rene Rosas': 91,
  'Roger': 105,
  'Luis Felipe': 88,
  'Diablo': null, // not in seed — will be created
  'Angel': 90,
  'Jorge': 80,
  'Felipe Dominguez': 88,
  'Pipe Dominguez': 88,
};

// ── Team name mapping: JSON (mixed case) → DB (uppercase) ───────────────────

const TEAM_NAME_MAP = {
  'Las Comadres': 'LAS COMADRES',
  'Charros': 'CHARROS',
  'Los Piojos': 'LOS PIOJOS',
  'Ellas y El': 'ELLAS Y EL',
  'Lobos': 'LOBOS',
  'La Pandilla': 'LA PANDILLA',
  '800 Plus': '800 PLUS',
  'Boliche GDL': 'BOLICHE GDL',
  'Pin Pals': 'PIN PALS',
  'Pin 8': 'PIN 8',
  'Buster Legion': 'BUSTER LEGION',
  'Hard Team': 'HARD TEAM',
  'Papis Team': 'PAPIS TEAM',
  'Los Aztecas': 'LOS AZTECAS',
  'Automotriz del Ahorro': 'AUTOMOTRIZ DEL AHORRO',
  'Panzer Division': 'PANZER DIVISION',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function toEmail(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') + '@patorneo.local';
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── 1. Look up tournament ──────────────────────────────────────────
    const tourneyRes = await client.query(
      "SELECT t.id FROM tournaments t JOIN leagues l ON t.league_id = l.id WHERE t.name = '28 Edicion' AND l.name = 'Patorneo'"
    );
    if (tourneyRes.rows.length === 0) throw new Error('Tournament "28 Edicion" not found. Run seed-patorneo.js first.');
    const tournamentId = tourneyRes.rows[0].id;
    console.log(`Tournament: ${tournamentId}`);

    // ── 2. Look up teams (DB name → UUID) ──────────────────────────────
    const teamsRes = await client.query('SELECT id, name FROM teams');
    const teamNameToId = {};
    for (const row of teamsRes.rows) {
      teamNameToId[row.name] = row.id;
    }

    // ── 3. Build pdfId → player UUID map ───────────────────────────────
    const playersRes = await client.query('SELECT id, email, name FROM players');
    const emailToPlayer = {};
    for (const row of playersRes.rows) {
      if (row.email) emailToPlayer[row.email.toLowerCase()] = row;
    }

    const pdfIdToUuid = {};
    const pdfIdToTeamName = {};
    for (const team of TEAMS_PDF) {
      for (const p of team.players) {
        const email = toEmail(p.name);
        const dbPlayer = emailToPlayer[email];
        if (dbPlayer) {
          pdfIdToUuid[p.pdfId] = dbPlayer.id;
          pdfIdToTeamName[p.pdfId] = team.name;
        } else {
          console.warn(`  WARN: No DB player for pdfId=${p.pdfId} name="${p.name}" email="${email}"`);
        }
      }
    }

    // Map name-based fallback entries
    for (const [jsonName, pdfId] of Object.entries(NAME_TO_PDF_ID)) {
      if (pdfId !== null) {
        // Already mapped via TEAMS_PDF
        if (!pdfIdToUuid[pdfId]) {
          console.warn(`  WARN: NAME_TO_PDF_ID "${jsonName}" → pdfId ${pdfId} not found in DB`);
        }
      }
    }

    // ── 4. Handle "Diablo" — create player if needed ───────────────────
    // Diablo appears on Charros in session 4
    const charrosTeamId = teamNameToId['CHARROS'];
    let diabloPlayerId;
    const diabloEmail = toEmail('Diablo');
    const existingDiablo = emailToPlayer[diabloEmail];
    if (existingDiablo) {
      diabloPlayerId = existingDiablo.id;
    } else {
      const ins = await client.query(
        "INSERT INTO players (name, email) VALUES ('Diablo', $1) ON CONFLICT DO NOTHING RETURNING id",
        [diabloEmail]
      );
      if (ins.rows.length > 0) {
        diabloPlayerId = ins.rows[0].id;
        console.log(`  Created player "Diablo": ${diabloPlayerId}`);
      } else {
        const existing2 = await client.query('SELECT id FROM players WHERE email = $1', [diabloEmail]);
        diabloPlayerId = existing2.rows[0].id;
      }
    }

    // ── 5. Idempotency: delete existing score data for this tournament ─
    // Order matters due to FK constraints
    await client.query('DELETE FROM scores WHERE tournament_id = $1', [tournamentId]);
    await client.query('DELETE FROM match_points WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = $1)', [tournamentId]);
    await client.query('DELETE FROM matches WHERE tournament_id = $1', [tournamentId]);
    await client.query('DELETE FROM tournament_sessions WHERE tournament_id = $1', [tournamentId]);
    await client.query('DELETE FROM team_statistics WHERE tournament_id = $1', [tournamentId]);
    await client.query('DELETE FROM player_statistics WHERE tournament_id = $1', [tournamentId]);
    console.log('  Cleared existing score data');

    // ── Helper: resolve player UUID from a JSON playerScore entry ──────
    function resolvePlayerId(ps, jsonTeamName) {
      // Try by pdfId first
      if (ps.id != null && pdfIdToUuid[ps.id]) {
        return pdfIdToUuid[ps.id];
      }
      // Try name-based fallback
      const mapped = NAME_TO_PDF_ID[ps.name];
      if (mapped !== undefined) {
        if (mapped === null) {
          // Diablo
          return diabloPlayerId;
        }
        return pdfIdToUuid[mapped];
      }
      console.error(`  ERROR: Cannot resolve player "${ps.name}" (id=${ps.id}) on team "${jsonTeamName}"`);
      return null;
    }

    // ── Helper: resolve team UUID from JSON team name ──────────────────
    function resolveTeamId(jsonTeamName) {
      const dbName = TEAM_NAME_MAP[jsonTeamName];
      if (!dbName) throw new Error(`Unknown JSON team name: "${jsonTeamName}"`);
      const id = teamNameToId[dbName];
      if (!id) throw new Error(`Team "${dbName}" not found in DB`);
      return id;
    }

    // ── 6. Insert sessions, matches, and scores ────────────────────────
    const sessionIds = {};   // sessionNumber → UUID
    const allMatchData = []; // collected for match_points calculation

    for (const session of data.sessions) {
      const sessionNum = session.number;
      // Session dates: start 2026-10-04, weekly
      const baseDate = new Date('2026-10-04');
      baseDate.setDate(baseDate.getDate() + (sessionNum - 1) * 7);
      const dateStr = baseDate.toISOString().split('T')[0];

      const sessRes = await client.query(
        `INSERT INTO tournament_sessions (tournament_id, session_number, session_name, session_date, status)
         VALUES ($1, $2, $3, $4, 'completed') RETURNING id`,
        [tournamentId, sessionNum, `Session ${sessionNum}`, dateStr]
      );
      const sessionId = sessRes.rows[0].id;
      sessionIds[sessionNum] = sessionId;
      console.log(`  Session ${sessionNum}: ${sessionId} (${dateStr})`);

      for (const match of session.matches) {
        const homeJsonTeam = match.teamResults[0];
        const awayJsonTeam = match.teamResults[1];
        const homeTeamId = resolveTeamId(homeJsonTeam.name);
        const awayTeamId = resolveTeamId(awayJsonTeam.name);

        // Insert match (winner determined later from points)
        const matchRes = await client.query(
          `INSERT INTO matches (tournament_id, session_id, home_team_id, away_team_id, session_number, status)
           VALUES ($1, $2, $3, $4, $5, 'completed') RETURNING id`,
          [tournamentId, sessionId, homeTeamId, awayTeamId, sessionNum]
        );
        const matchId = matchRes.rows[0].id;

        // Insert scores for both teams
        const scoreRows = []; // {teamId, playerId, gameNumber, score, hdcp}
        for (const teamResult of match.teamResults) {
          const teamId = resolveTeamId(teamResult.name);
          for (const game of teamResult.games) {
            for (const ps of game.playerScores) {
              const playerId = resolvePlayerId(ps, teamResult.name);
              if (!playerId) continue;
              scoreRows.push({
                teamId,
                playerId,
                gameNumber: game.game,
                score: ps.scratch,
                hdcp: ps.hdcp,
              });
            }
          }
        }

        // Batch insert scores
        for (const sr of scoreRows) {
          await client.query(
            `INSERT INTO scores (session_id, tournament_id, player_id, team_id, match_id, game_number, score, handicap_applied)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [sessionId, tournamentId, sr.playerId, sr.teamId, matchId, sr.gameNumber, sr.score, sr.hdcp]
          );
        }

        // Collect match data for points calculation
        allMatchData.push({
          matchId,
          sessionId,
          homeTeamId,
          awayTeamId,
          homeGames: homeJsonTeam.games,
          awayGames: awayJsonTeam.games,
          homeJsonName: homeJsonTeam.name,
          awayJsonName: awayJsonTeam.name,
        });
      }
    }

    console.log(`  Inserted ${allMatchData.length} matches`);

    // ── 7. Calculate and insert match_points ───────────────────────────
    // Track team stats accumulators
    const teamStats = {}; // teamId → { matchesPlayed, won, lost, totalScore, totalPoints }

    function ensureTeamStats(teamId) {
      if (!teamStats[teamId]) {
        teamStats[teamId] = { matchesPlayed: 0, won: 0, lost: 0, totalScore: 0, totalPoints: 0 };
      }
    }

    for (const md of allMatchData) {
      // Calculate per-game points using pins_with_hdcp (scratch + hdcp)
      const homeGamePoints = [];
      const awayGamePoints = [];
      let homeSeries = 0;
      let awaySeries = 0;

      for (let g = 1; g <= 3; g++) {
        // Sum (scratch + hdcp) for each team's players in this game
        const homeGame = md.homeGames.find(gm => gm.game === g);
        const awayGame = md.awayGames.find(gm => gm.game === g);

        let homeTotal = 0;
        let awayTotal = 0;

        if (homeGame) {
          for (const ps of homeGame.playerScores) {
            homeTotal += ps.scratch + ps.hdcp;
          }
        }
        if (awayGame) {
          for (const ps of awayGame.playerScores) {
            awayTotal += ps.scratch + ps.hdcp;
          }
        }

        homeSeries += homeTotal;
        awaySeries += awayTotal;

        homeGamePoints.push(homeTotal > awayTotal ? 1 : 0);
        awayGamePoints.push(awayTotal > homeTotal ? 1 : 0);
      }

      const homeSeriesPoints = homeSeries > awaySeries ? 1 : 0;
      const awaySeriesPoints = awaySeries > homeSeries ? 1 : 0;
      const homeTotalPoints = homeGamePoints.reduce((a, b) => a + b, 0) + homeSeriesPoints;
      const awayTotalPoints = awayGamePoints.reduce((a, b) => a + b, 0) + awaySeriesPoints;

      // Determine winner
      let winnerTeamId = null;
      if (homeTotalPoints > awayTotalPoints) winnerTeamId = md.homeTeamId;
      else if (awayTotalPoints > homeTotalPoints) winnerTeamId = md.awayTeamId;

      // Update match winner
      await client.query('UPDATE matches SET winner_team_id = $1 WHERE id = $2', [winnerTeamId, md.matchId]);

      // Insert match_points
      await client.query(
        `INSERT INTO match_points (match_id, home_team_id, away_team_id,
           home_game_points, home_series_points, home_total_points,
           away_game_points, away_series_points, away_total_points)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          md.matchId, md.homeTeamId, md.awayTeamId,
          JSON.stringify(homeGamePoints), homeSeriesPoints, homeTotalPoints,
          JSON.stringify(awayGamePoints), awaySeriesPoints, awayTotalPoints,
        ]
      );

      // Accumulate team stats
      ensureTeamStats(md.homeTeamId);
      ensureTeamStats(md.awayTeamId);
      teamStats[md.homeTeamId].matchesPlayed++;
      teamStats[md.awayTeamId].matchesPlayed++;
      teamStats[md.homeTeamId].totalPoints += homeTotalPoints;
      teamStats[md.awayTeamId].totalPoints += awayTotalPoints;
      teamStats[md.homeTeamId].totalScore += homeSeries;
      teamStats[md.awayTeamId].totalScore += awaySeries;

      if (winnerTeamId === md.homeTeamId) {
        teamStats[md.homeTeamId].won++;
        teamStats[md.awayTeamId].lost++;
      } else if (winnerTeamId === md.awayTeamId) {
        teamStats[md.awayTeamId].won++;
        teamStats[md.homeTeamId].lost++;
      }
    }

    console.log('  Inserted match_points');

    // ── 8. Insert team_statistics ──────────────────────────────────────
    for (const [teamId, stats] of Object.entries(teamStats)) {
      const pctDenom = stats.matchesPlayed * 4;
      const pct = pctDenom > 0 ? Math.round((stats.totalPoints / pctDenom) * 10000) / 100 : 0;
      const avg = stats.matchesPlayed > 0
        ? Math.round((stats.totalScore / (stats.matchesPlayed * 3)) * 100) / 100
        : 0;

      await client.query(
        `INSERT INTO team_statistics (team_id, tournament_id, total_matches_played, matches_won, matches_lost,
           total_team_score, team_average, total_points, points_percentage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [teamId, tournamentId, stats.matchesPlayed, stats.won, stats.lost,
         stats.totalScore, avg, stats.totalPoints, pct]
      );
    }
    console.log(`  Inserted ${Object.keys(teamStats).length} team_statistics rows`);

    // ── 9. Insert player_statistics ────────────────────────────────────
    // Aggregate from scores table directly
    const playerStatsRes = await client.query(
      `SELECT
         s.player_id,
         s.team_id,
         COUNT(*) AS games_played,
         SUM(s.score) AS total_pins,
         ROUND(AVG(s.score)::numeric, 2) AS current_average,
         MAX(s.score) AS highest_game,
         COUNT(DISTINCT s.match_id) AS matches_played
       FROM scores s
       WHERE s.tournament_id = $1
       GROUP BY s.player_id, s.team_id`,
      [tournamentId]
    );

    // Compute highest series per player (sum of scratch per match)
    const seriesRes = await client.query(
      `SELECT s.player_id, s.team_id, s.match_id, SUM(s.score) AS series_total
       FROM scores s
       WHERE s.tournament_id = $1
       GROUP BY s.player_id, s.team_id, s.match_id`,
      [tournamentId]
    );
    const highestSeriesMap = {}; // "playerId|teamId" → max series
    for (const row of seriesRes.rows) {
      const key = `${row.player_id}|${row.team_id}`;
      const val = parseInt(row.series_total, 10);
      if (!highestSeriesMap[key] || val > highestSeriesMap[key]) {
        highestSeriesMap[key] = val;
      }
    }

    // Get latest handicap per player (from their most recent session's score)
    const latestHdcpRes = await client.query(
      `SELECT DISTINCT ON (s.player_id, s.team_id)
         s.player_id, s.team_id, s.handicap_applied
       FROM scores s
       JOIN tournament_sessions ts ON s.session_id = ts.id
       WHERE s.tournament_id = $1
       ORDER BY s.player_id, s.team_id, ts.session_number DESC, s.game_number DESC`,
      [tournamentId]
    );
    const latestHdcpMap = {}; // "playerId|teamId" → hdcp
    for (const row of latestHdcpRes.rows) {
      latestHdcpMap[`${row.player_id}|${row.team_id}`] = row.handicap_applied;
    }

    let playerStatsCount = 0;
    for (const row of playerStatsRes.rows) {
      const key = `${row.player_id}|${row.team_id}`;
      const highestSeries = highestSeriesMap[key] || 0;
      const currentHdcp = latestHdcpMap[key] || 0;

      await client.query(
        `INSERT INTO player_statistics (player_id, tournament_id, team_id,
           games_played, total_pins, current_average, highest_game, highest_series,
           matches_played)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (player_id, tournament_id, team_id) DO UPDATE SET
           games_played = EXCLUDED.games_played,
           total_pins = EXCLUDED.total_pins,
           current_average = EXCLUDED.current_average,
           highest_game = EXCLUDED.highest_game,
           highest_series = EXCLUDED.highest_series,
           matches_played = EXCLUDED.matches_played,
           last_updated = CURRENT_TIMESTAMP`,
        [row.player_id, tournamentId, row.team_id,
         parseInt(row.games_played, 10), parseInt(row.total_pins, 10),
         parseFloat(row.current_average), parseInt(row.highest_game, 10),
         highestSeries, parseInt(row.matches_played, 10)]
      );
      playerStatsCount++;
    }
    console.log(`  Inserted ${playerStatsCount} player_statistics rows`);

    await client.query('COMMIT');
    console.log('\nScore seed complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed, rolled back:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
