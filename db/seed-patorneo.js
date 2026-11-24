#!/usr/bin/env node
// db/seed-patorneo.js
// Seeds the Patorneo "28 Edicion" tournament with 16 teams and ~90 players.
// Structural data only — no individual game scores (awaiting granular session reports).
//
// Run after migrations: node db/seed-patorneo.js
//
// Creates:
//  - "Patorneo" league (if not present)
//  - 16 teams with captains
//  - ~90 players across all teams (rosters from PDF standings)
//  - "28 Edicion" tournament (23 sessions, 3 games/session, lineup_size 3, paired format)
//  - Tournament registrations + team rosters

require('dotenv').config({ path: './.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:example@localhost:5432/bowling-tourney',
});

// ── Team definitions ──────────────────────────────────────────────────────────
// First player in each roster is the captain.
// PDF ID is the player's original spreadsheet ID (for reference only).

const TEAMS = [
  {
    name: 'LAS COMADRES', pdfId: 'E1',
    players: [
      { name: 'Marco Contreras', pdfId: 98, hdcp: 20 },
      { name: 'Alex Rodriguez', pdfId: 56, hdcp: 23 },
      { name: 'Itzayana Escamilla', pdfId: 57, hdcp: 63 },
      { name: 'Rebeca Espinosa', pdfId: 52, hdcp: 75 },
      { name: 'Ismael', pdfId: 120, hdcp: null },
      { name: 'Mauricio Aguilar', pdfId: 53, hdcp: null },
    ],
  },
  {
    name: 'CHARROS', pdfId: 'E2',
    players: [
      { name: 'Alvaro Na', pdfId: 15, hdcp: 0 },
      { name: 'Carlos Serros', pdfId: 13, hdcp: 0 },
      { name: 'Hugo Brihuega', pdfId: 16, hdcp: 21 },
      { name: 'Julio Villanueva', pdfId: 14, hdcp: 27 },
      { name: 'JESSI SOTO', pdfId: 103, hdcp: null },
      { name: 'AGUSTINA CEBALLOS', pdfId: 18, hdcp: 19 },
    ],
  },
  {
    name: 'LOS PIOJOS', pdfId: 'E3',
    players: [
      { name: 'Hugo Montes', pdfId: 73, hdcp: 4 },
      { name: 'Sergio Loyola', pdfId: 74, hdcp: 11 },
      { name: 'Carlos Montes', pdfId: 71, hdcp: 20 },
      { name: 'Roberto sanchez', pdfId: 72, hdcp: 22 },
      { name: 'ERIK LOPEZ', pdfId: 104, hdcp: null },
      { name: 'Tono Ruiz', pdfId: 75, hdcp: 3 },
      { name: 'Hugo Lopez', pdfId: 76, hdcp: null },
    ],
  },
  {
    name: 'ELLAS Y EL', pdfId: 'E4',
    players: [
      { name: 'POLO JR', pdfId: 68, hdcp: 3 },
      { name: 'EMILIO GALINDO', pdfId: 67, hdcp: 14 },
      { name: 'ADREA CUERVO', pdfId: 65, hdcp: 19 },
      { name: 'BENJAMIN RAMIREZ', pdfId: 69, hdcp: null },
      { name: 'MARU MARTINEZ', pdfId: 66, hdcp: 26 },
    ],
  },
  {
    name: 'LOBOS', pdfId: 'E5',
    players: [
      { name: 'Juan Manuel Padilla', pdfId: 20, hdcp: 8 },
      { name: 'Alex Padilla', pdfId: 21, hdcp: 17 },
      { name: 'Kuko Comparan', pdfId: 23, hdcp: 25 },
      { name: 'Ricardo Garcia', pdfId: 19, hdcp: null },
      { name: 'Jorge Padilla', pdfId: 24, hdcp: 24 },
    ],
  },
  {
    name: 'LA PANDILLA', pdfId: 'E6',
    players: [
      { name: 'SERGIO ESQUIVEL', pdfId: 92, hdcp: 21 },
      { name: 'ENRIQE ESQUIVEL', pdfId: 110, hdcp: 25 },
      { name: 'Julio Cesar Plascencia', pdfId: 79, hdcp: 50 },
      { name: 'ISRAEL', pdfId: 78, hdcp: 50 },
      { name: 'JORGE', pdfId: 80, hdcp: 29 },
      { name: 'Miguel Moya', pdfId: 99, hdcp: 40 },
    ],
  },
  {
    name: '800 PLUS', pdfId: 'E7',
    players: [
      { name: 'Benjamin Martinez', pdfId: 37, hdcp: 3 },
      { name: 'LUIS DANIEL VARELA', pdfId: 38, hdcp: 0 },
      { name: 'Charly Ayala', pdfId: 41, hdcp: 0 },
      { name: 'MANUEL ALVARADO', pdfId: 121, hdcp: 3 },
      { name: 'Oswaldo de Luna', pdfId: 42, hdcp: 2 },
      { name: 'Francisco Ruvalcaba', pdfId: 39, hdcp: 42 },
    ],
  },
  {
    name: 'BOLICHE GDL', pdfId: 'E8',
    players: [
      { name: 'BETO', pdfId: 32, hdcp: 28 },
      { name: 'ALFONSO', pdfId: 33, hdcp: 30 },
      { name: 'ANDRES', pdfId: 31, hdcp: 39 },
      { name: 'FABRIZZIO', pdfId: 35, hdcp: 34 },
      { name: 'HUGO MEZA', pdfId: 55, hdcp: 48 },
    ],
  },
  {
    name: 'PIN PALS', pdfId: 'E9',
    players: [
      { name: 'Fer Costa', pdfId: 63, hdcp: 0 },
      { name: 'Andres Carrasco', pdfId: 61, hdcp: 0 },
      { name: 'Luis Ordaz', pdfId: 60, hdcp: 10 },
      { name: 'Mundo Pineda', pdfId: 62, hdcp: 8 },
      { name: 'Cipriano Pineda', pdfId: 64, hdcp: 15 },
      { name: 'IRVING SANDOVAL', pdfId: 59, hdcp: 26 },
    ],
  },
  {
    name: 'PIN 8', pdfId: 'E10',
    players: [
      { name: 'DAVID ROJAS', pdfId: 43, hdcp: 39 },
      { name: 'CARLOS LARIOS', pdfId: 45, hdcp: 41 },
      { name: 'ALEJANDRO RUBIO', pdfId: 44, hdcp: 48 },
    ],
  },
  {
    name: 'BUSTER LEGION', pdfId: 'E11',
    players: [
      { name: 'Miguel Torres', pdfId: 97, hdcp: 37 },
      { name: 'Arturo Cepeda', pdfId: 95, hdcp: 42 },
      { name: 'Carlos Hernandez', pdfId: 102, hdcp: 43 },
      { name: 'Lupita Lopez', pdfId: 96, hdcp: 66 },
      { name: 'Luis Carlos', pdfId: 93, hdcp: 21 },
      { name: 'LUIS JR', pdfId: 94, hdcp: null },
    ],
  },
  {
    name: 'HARD TEAM', pdfId: 'E12',
    players: [
      { name: 'Alexis Ramirez', pdfId: 83, hdcp: 19 },
      { name: 'Murphy Ortiz', pdfId: 85, hdcp: 30 },
      { name: 'Victor Badillo', pdfId: 84, hdcp: 29 },
      { name: 'Juan Ramirez', pdfId: 81, hdcp: 50 },
      { name: 'Emmanuel Gonzalez', pdfId: 82, hdcp: 36 },
    ],
  },
  {
    name: 'PAPIS TEAM', pdfId: 'E13',
    players: [
      { name: 'JOSE LUIS MARTINEZ', pdfId: 3, hdcp: 0 },
      { name: 'JAVIER LARIOS', pdfId: 1, hdcp: 0 },
      { name: 'MAX MARTINEZ', pdfId: 2, hdcp: 33 },
      { name: 'MARCO', pdfId: 6, hdcp: null },
      { name: 'LUIS GUILLERMO ESTRADA', pdfId: 5, hdcp: null },
      { name: 'SCARLETT PADILLA', pdfId: 4, hdcp: null },
    ],
  },
  {
    name: 'LOS AZTECAS', pdfId: 'E14',
    players: [
      { name: 'GONZALO PALACIOS', pdfId: 89, hdcp: 10 },
      { name: 'RENE ROSAS PIPE', pdfId: 91, hdcp: 33 },
      { name: 'ROGELIO', pdfId: 105, hdcp: 30 },
      { name: 'MARIO GOMEZ', pdfId: 87, hdcp: 34 },
      { name: 'FELIPE DOMINGUEZ', pdfId: 88, hdcp: 50 },
      { name: 'ANGEL FAUSTO', pdfId: 90, hdcp: 50 },
    ],
  },
  {
    name: 'AUTOMOTRIZ DEL AHORRO', pdfId: 'E15',
    players: [
      { name: 'Omar Aguirre', pdfId: 25, hdcp: 15 },
      { name: 'Jair Moreno', pdfId: 28, hdcp: 21 },
      { name: 'Jonathan Moreno', pdfId: 29, hdcp: 0 },
      { name: 'Mauricio Aguirre', pdfId: 26, hdcp: 21 },
      { name: 'OMAR AGUIRRE JR', pdfId: 30, hdcp: 9 },
      { name: 'BETO MORENO', pdfId: 36, hdcp: 23 },
      { name: 'Patricia Moreno', pdfId: 27, hdcp: 28 },
    ],
  },
  {
    name: 'PANZER DIVISION', pdfId: 'E16',
    players: [
      { name: 'Angel Murga', pdfId: 9, hdcp: 25 },
      { name: 'MIGUEL OROZCO', pdfId: 11, hdcp: 0 },
      { name: 'Juan Pablo Poblano', pdfId: 10, hdcp: 28 },
      { name: 'Jorge Ortiz', pdfId: 12, hdcp: 17 },
      { name: 'Alvaro Chaves', pdfId: 7, hdcp: 32 },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toEmail(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') + '@patorneo.local';
}

// ── Main seed ─────────────────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── League: Patorneo ────────────────────────────────────────────────
    const leagueRes = await client.query(
      `INSERT INTO leagues (name, description, league_type, max_teams_per_tournament)
       VALUES ('Patorneo', 'Liga de boliche Patorneo - Guadalajara', 'standard', 16)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const leagueId = leagueRes.rows[0].id;
    console.log(`League "Patorneo": ${leagueId}`);

    // ── Tournament: 28 Edicion ──────────────────────────────────────────
    const tourneyRes = await client.query(
      `INSERT INTO tournaments (
         name, league_id, season, year,
         schedule_type, ranking_method, lineup_size,
         scoring_config,
         start_date, end_date, max_teams, total_sessions,
         session_type, status
       ) VALUES (
         '28 Edicion', $1, 'annual', 2026,
         'paired', 'points', 3,
         '{"games_per_session":3,"handicap":{"base_score":210,"percentage":90,"floor":0,"cap":null},"points":{"per_game_win":1,"per_game_tie":0.5,"per_series_win":1,"per_series_tie":0.5,"bonus_categories":[],"per_bonus":1}}'::jsonb,
         '2026-01-01', '2026-12-31', 16, 23,
         'weekly', 'active'
       )
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [leagueId]
    );

    let tournamentId;
    if (tourneyRes.rows.length > 0) {
      tournamentId = tourneyRes.rows[0].id;
    } else {
      const existing = await client.query(
        "SELECT id FROM tournaments WHERE name = '28 Edicion' AND league_id = $1",
        [leagueId]
      );
      tournamentId = existing.rows[0].id;
    }
    console.log(`Tournament "28 Edicion": ${tournamentId}`);

    // ── Players, Teams, Rosters ─────────────────────────────────────────
    let playerCount = 0;
    let teamCount = 0;

    for (const team of TEAMS) {
      // Create team (first player is captain)
      const captain = team.players[0];
      const teamRes = await client.query(
        `INSERT INTO teams (name, captain_name, captain_email, team_type)
         VALUES ($1, $2, $3, 'standard')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [team.name, captain.name, toEmail(captain.name)]
      );

      let teamId;
      if (teamRes.rows.length > 0) {
        teamId = teamRes.rows[0].id;
      } else {
        const existing = await client.query('SELECT id FROM teams WHERE name = $1', [team.name]);
        teamId = existing.rows[0].id;
      }
      teamCount++;

      // Register team in tournament
      await client.query(
        `INSERT INTO tournament_teams (tournament_id, team_id)
         VALUES ($1, $2)
         ON CONFLICT (tournament_id, team_id) DO NOTHING`,
        [tournamentId, teamId]
      );

      // Create players and add to roster
      for (let i = 0; i < team.players.length; i++) {
        const p = team.players[i];
        const email = toEmail(p.name);

        const playerRes = await client.query(
          `INSERT INTO players (name, email, status)
           VALUES ($1, $2, 'active')
           RETURNING id`,
          [p.name, email]
        );
        const playerId = playerRes.rows[0].id;
        playerCount++;

        // Add to team roster — first player is captain
        const role = i === 0 ? 'captain' : 'regular';
        await client.query(
          `INSERT INTO team_players (team_id, player_id, tournament_id, role, is_active)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT DO NOTHING`,
          [teamId, playerId, tournamentId, role]
        );
      }
    }

    console.log(`Created ${teamCount} teams, ${playerCount} players`);

    await client.query('COMMIT');
    console.log('\nPatorneo seed completed successfully.');
    console.log('Note: No scores seeded — awaiting granular session reports.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
