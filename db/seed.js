#!/usr/bin/env node
// db/seed.js
// Seeds the database with realistic bowling league data.
// Run after migrations: node db/seed.js
//
// Creates:
//  - 3 leagues (already in migration 002, skipped if present)
//  - 12 players across 4 teams
//  - 1 league admin (Maria)
//  - 1 paired tournament with 4 sessions of scores
//  - Player statistics auto-populated by DB trigger on score insert

require('dotenv').config({ path: './.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:example@localhost:5432/bowling-tourney',
});

// ── Deterministic UUIDs for easy reference ──────────────────────────────────

const ID = {
  // Leagues (match migration 002 seeds by name, we'll look them up)
  mainLeague: null,

  // Admin
  maria: '00000000-0000-4000-a000-000000000001',

  // Teams
  rollingThunder: '00000000-0000-4000-b000-000000000001',
  pinCrushers:    '00000000-0000-4000-b000-000000000002',
  gutterGuards:   '00000000-0000-4000-b000-000000000003',
  strikeForce:    '00000000-0000-4000-b000-000000000004',

  // Players — 3 per team
  alice:  '00000000-0000-4000-c000-000000000001',
  andy:   '00000000-0000-4000-c000-000000000002',
  amy:    '00000000-0000-4000-c000-000000000003',
  bob:    '00000000-0000-4000-c000-000000000004',
  beth:   '00000000-0000-4000-c000-000000000005',
  ben:    '00000000-0000-4000-c000-000000000006',
  carol:  '00000000-0000-4000-c000-000000000007',
  chris:  '00000000-0000-4000-c000-000000000008',
  chloe:  '00000000-0000-4000-c000-000000000009',
  dave:   '00000000-0000-4000-c000-000000000010',
  diana:  '00000000-0000-4000-c000-000000000011',
  dan:    '00000000-0000-4000-c000-000000000012',

  // Tournament
  fallTournament: '00000000-0000-4000-d000-000000000001',
};

const TEAMS = [
  { id: ID.rollingThunder, name: 'Rolling Thunder', captain: 'Alice', email: 'alice@seed.local',
    players: [
      { id: ID.alice, name: 'Alice', email: 'alice@seed.local' },
      { id: ID.andy,  name: 'Andy',  email: 'andy@seed.local' },
      { id: ID.amy,   name: 'Amy',   email: 'amy@seed.local' },
    ],
  },
  { id: ID.pinCrushers, name: 'Pin Crushers', captain: 'Bob', email: 'bob@seed.local',
    players: [
      { id: ID.bob,  name: 'Bob',  email: 'bob@seed.local' },
      { id: ID.beth, name: 'Beth', email: 'beth@seed.local' },
      { id: ID.ben,  name: 'Ben',  email: 'ben@seed.local' },
    ],
  },
  { id: ID.gutterGuards, name: 'Gutter Guards', captain: 'Carol', email: 'carol@seed.local',
    players: [
      { id: ID.carol, name: 'Carol', email: 'carol@seed.local' },
      { id: ID.chris, name: 'Chris', email: 'chris@seed.local' },
      { id: ID.chloe, name: 'Chloe', email: 'chloe@seed.local' },
    ],
  },
  { id: ID.strikeForce, name: 'Strike Force', captain: 'Dave', email: 'dave@seed.local',
    players: [
      { id: ID.dave,  name: 'Dave',  email: 'dave@seed.local' },
      { id: ID.diana, name: 'Diana', email: 'diana@seed.local' },
      { id: ID.dan,   name: 'Dan',   email: 'dan@seed.local' },
    ],
  },
];

// Scores per player per session (4 sessions, 3 games each)
// Realistic bowling scores: averages range from ~155 to ~210
const PLAYER_SCORES = {
  [ID.alice]: [[185, 195, 190], [192, 188, 194], [186, 196, 191], [190, 185, 195]],
  [ID.andy]:  [[165, 175, 170], [172, 168, 174], [166, 176, 171], [170, 165, 175]],
  [ID.amy]:   [[155, 165, 160], [162, 158, 164], [156, 166, 161], [160, 155, 165]],
  [ID.bob]:   [[195, 205, 200], [202, 198, 204], [196, 206, 201], [200, 195, 205]],
  [ID.beth]:  [[180, 190, 185], [187, 183, 189], [181, 191, 186], [185, 180, 190]],
  [ID.ben]:   [[170, 180, 175], [177, 173, 179], [171, 181, 176], [175, 170, 180]],
  [ID.carol]: [[175, 185, 180], [182, 178, 184], [176, 186, 181], [180, 175, 185]],
  [ID.chris]: [[160, 170, 165], [167, 163, 169], [161, 171, 166], [165, 160, 170]],
  [ID.chloe]: [[150, 160, 155], [157, 153, 159], [151, 161, 156], [155, 150, 160]],
  [ID.dave]:  [[205, 215, 210], [212, 208, 214], [206, 216, 211], [210, 205, 215]],
  [ID.diana]: [[190, 200, 195], [197, 193, 199], [191, 201, 196], [195, 190, 200]],
  [ID.dan]:   [[165, 175, 170], [172, 168, 174], [166, 176, 171], [170, 165, 175]],
};

// Round-robin schedule for 4 teams across 4 sessions (each pair meets at least once)
// [homeTeamIndex, awayTeamIndex]
const SCHEDULE = [
  // Session 1: RT vs PC, GG vs SF
  [[0, 1], [2, 3]],
  // Session 2: RT vs GG, PC vs SF
  [[0, 2], [1, 3]],
  // Session 3: RT vs SF, PC vs GG
  [[0, 3], [1, 2]],
  // Session 4: rematch — RT vs PC, GG vs SF
  [[0, 1], [2, 3]],
];

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Look up Main Bowling League (seeded by migration 002) ───────────
    const leagueRes = await client.query(
      "SELECT id FROM leagues WHERE name = 'Main Bowling League'"
    );
    if (leagueRes.rows.length === 0) {
      throw new Error('Main Bowling League not found — run migrations first');
    }
    ID.mainLeague = leagueRes.rows[0].id;
    console.log(`Using league: ${ID.mainLeague}`);

    // ── Maria (league admin) ────────────────────────────────────────────
    await client.query(
      `INSERT INTO players (id, name, email, status)
       VALUES ($1, 'Maria Admin', 'maria@seed.local', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [ID.maria]
    );
    await client.query(
      `INSERT INTO league_admins (player_id, league_id, assigned_by)
       VALUES ($1, $2, $1)
       ON CONFLICT DO NOTHING`,
      [ID.maria, ID.mainLeague]
    );
    console.log('Created Maria (league admin)');

    // ── Players ─────────────────────────────────────────────────────────
    for (const team of TEAMS) {
      for (const p of team.players) {
        await client.query(
          `INSERT INTO players (id, name, email, status)
           VALUES ($1, $2, $3, 'active')
           ON CONFLICT (id) DO NOTHING`,
          [p.id, p.name, p.email]
        );
      }
    }
    console.log('Created 12 players');

    // ── Teams ───────────────────────────────────────────────────────────
    for (const team of TEAMS) {
      await client.query(
        `INSERT INTO teams (id, name, captain_name, captain_email, team_type)
         VALUES ($1, $2, $3, $4, 'standard')
         ON CONFLICT (id) DO NOTHING`,
        [team.id, team.name, team.captain, team.email]
      );
    }
    console.log('Created 4 teams');

    // ── Tournament ──────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO tournaments (
         id, name, league_id, season, year,
         schedule_type, ranking_method, lineup_size,
         scoring_config,
         start_date, end_date, max_teams, total_sessions,
         session_type, status
       ) VALUES (
         $1, 'Fall Classic 2026', $2, 'fall', 2026,
         'paired', 'points', 3,
         '{"games_per_session":3,"handicap":{"base_score":220,"percentage":80,"floor":0,"cap":null},"points":{"per_game_win":1,"per_game_tie":0.5,"per_series_win":1,"per_series_tie":0.5,"bonus_categories":[],"per_bonus":1}}'::jsonb,
         '2026-09-01', '2026-12-15', 8, 4,
         'weekly', 'active'
       ) ON CONFLICT (id) DO NOTHING`,
      [ID.fallTournament, ID.mainLeague]
    );
    console.log('Created tournament: Fall Classic 2026');

    // ── Register teams ──────────────────────────────────────────────────
    for (const team of TEAMS) {
      await client.query(
        `INSERT INTO tournament_teams (tournament_id, team_id)
         VALUES ($1, $2)
         ON CONFLICT (tournament_id, team_id) DO NOTHING`,
        [ID.fallTournament, team.id]
      );

      // Add players to team roster for this tournament
      for (const p of team.players) {
        await client.query(
          `INSERT INTO team_players (team_id, player_id, tournament_id, is_active)
           VALUES ($1, $2, $3, true)
           ON CONFLICT DO NOTHING`,
          [team.id, p.id, ID.fallTournament]
        );
      }
    }
    console.log('Registered 4 teams with rosters');

    // ── Sessions ────────────────────────────────────────────────────────
    const sessionIds = [];
    for (let i = 0; i < 4; i++) {
      const sessionDate = new Date(2026, 8, 7 + i * 7); // Sep 7, 14, 21, 28
      const res = await client.query(
        `INSERT INTO tournament_sessions (tournament_id, session_number, session_name, session_date, status)
         VALUES ($1, $2, $3, $4, 'completed')
         RETURNING id`,
        [ID.fallTournament, i + 1, `Week ${i + 1}`, sessionDate]
      );
      sessionIds.push(res.rows[0].id);
    }
    console.log('Created 4 sessions');

    // ── Matches & Scores ────────────────────────────────────────────────
    let matchCount = 0;
    let scoreCount = 0;

    for (let sessionIdx = 0; sessionIdx < SCHEDULE.length; sessionIdx++) {
      const sessionId = sessionIds[sessionIdx];
      const matchups = SCHEDULE[sessionIdx];

      for (const [homeIdx, awayIdx] of matchups) {
        const homeTeam = TEAMS[homeIdx];
        const awayTeam = TEAMS[awayIdx];

        const matchRes = await client.query(
          `INSERT INTO matches (tournament_id, home_team_id, away_team_id, session_id, session_number, status)
           VALUES ($1, $2, $3, $4, $5, 'completed')
           RETURNING id`,
          [ID.fallTournament, homeTeam.id, awayTeam.id, sessionId, sessionIdx + 1]
        );
        const matchId = matchRes.rows[0].id;
        matchCount++;

        // Insert scores for both teams
        for (const team of [homeTeam, awayTeam]) {
          for (const player of team.players) {
            const games = PLAYER_SCORES[player.id][sessionIdx];
            for (let g = 0; g < games.length; g++) {
              await client.query(
                `INSERT INTO scores (session_id, tournament_id, player_id, team_id, match_id, game_number, score)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [sessionId, ID.fallTournament, player.id, team.id, matchId, g + 1, games[g]]
              );
              scoreCount++;
            }
          }
        }
      }
    }
    console.log(`Created ${matchCount} matches, ${scoreCount} scores`);
    console.log('(player_statistics auto-populated by DB trigger)');

    await client.query('COMMIT');
    console.log('\nSeed completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
