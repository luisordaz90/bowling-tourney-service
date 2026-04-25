// scripts/solo-scenario.js
// Live scenario: solo open-format tournament, 10 players, 10 sessions, 3 games each.
//
// Writes use postgres (admin) credentials directly — bypasses RLS.
// Reads use the HTTP API — same view any client would get.
//
// Data is NOT deleted after the run.

require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const BASE = 'http://localhost:3000/api';

// Admin pool — bypasses RLS
const adminPool = new Pool({
  user:     process.env.DB_USER     || 'postgres',
  host:     process.env.DB_HOST     || 'localhost',
  database: process.env.DB_NAME     || 'bowling-tourney',
  password: process.env.DB_PASSWORD || 'example',
  port:     process.env.DB_PORT     || 5432,
});

const sql = (text, params) => adminPool.query(text, params);
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const json = await res.json();
  if (res.status >= 400) throw new Error(`GET ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const PLAYER_NAMES = [
  'Alice Holt',  'Ben Farrow',  'Cara Nguyen', 'Diego Reyes', 'Eliza Burns',
  'Frank Osei',  'Grace Kim',   'Hiro Tanaka', 'Isla Monroe', 'Jack Vega',
];

async function main() {
  const lines = [];
  const log = (...args) => console.log(...args);
  const md  = (line)    => lines.push(line);

  log('=== Solo Tournament Scenario ===\n');

  // ── 1. Create tournament ────────────────────────────────────────────────────
  const tRes = await sql(
    `INSERT INTO tournaments
       (name, start_date, end_date, max_teams, total_sessions, session_type,
        schedule_type, ranking_method, hdcp_base, hdcp_percentage, games_per_session)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    ['Solo Open Classic 2026',
     '2026-03-01', '2026-06-30',
     1, 10, 'weekly', 'open', 'pins',
     220, 0.90, 3]
  );
  const tournament = tRes.rows[0];
  const tId = tournament.id;
  log(`Tournament created: ${tId}`);

  // ── 2. Create 10 players ────────────────────────────────────────────────────
  const players = [];
  for (const name of PLAYER_NAMES) {
    const email = name.toLowerCase().replace(' ', '.') + '@solo.test';
    const r = await sql(
      `INSERT INTO players (name, email, handicap) VALUES ($1,$2,0) RETURNING *`,
      [name, email]
    );
    players.push(r.rows[0]);
    log(`  Player: ${name} (${r.rows[0].id})`);
  }

  // ── 3. Create 10 sessions ───────────────────────────────────────────────────
  const sessions = [];
  for (let i = 1; i <= 10; i++) {
    const d = new Date('2026-03-01');
    d.setDate(d.getDate() + (i - 1) * 7);
    const r = await sql(
      `INSERT INTO league_sessions (tournament_id, session_number, session_name, session_date)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [tId, i, `Week ${i}`, d.toISOString().slice(0, 10)]
    );
    sessions.push(r.rows[0]);
    log(`  Session ${i} created`);
  }

  // ── 4. Submit scores ────────────────────────────────────────────────────────
  log('\nSubmitting scores…');
  const scoreMatrix = {}; // [playerId][sessionNumber] = { g1, g2, g3 }

  for (const session of sessions) {
    const sNum = session.session_number;
    for (const player of players) {
      const g1 = rand(100, 280);
      const g2 = rand(100, 280);
      const g3 = rand(100, 280);

      for (let g = 1; g <= 3; g++) {
        const score = g === 1 ? g1 : g === 2 ? g2 : g3;
        await sql(
          `INSERT INTO scores
             (session_id, tournament_id, player_id, team_id, match_id,
              game_number, score, handicap_applied)
           VALUES ($1,$2,$3,NULL,NULL,$4,$5,0)`,
          [session.id, tId, player.id, g, score]
        );
      }

      if (!scoreMatrix[player.id]) scoreMatrix[player.id] = {};
      scoreMatrix[player.id][sNum] = { g1, g2, g3 };
    }
    log(`  Session ${sNum} scored`);
  }

  await adminPool.end();

  // ── 5. Query API as a player ────────────────────────────────────────────────
  log('\nQuerying API…');
  const standings = await get(`/tournaments/${tId}/standings`);
  const allStats  = await get(`/tournaments/${tId}/player-statistics`);
  const p0Stats   = await get(`/tournaments/${tId}/players/${players[0].id}/statistics`);

  // Fetch scores session by session and combine
  const allSessionScores = [];
  for (let s = 1; s <= 10; s++) {
    const rows = await get(`/tournaments/${tId}/scores?session=${s}`);
    if (Array.isArray(rows)) allSessionScores.push(...rows.map(r => ({ session: s, ...r })));
  }
  const scores = allSessionScores;

  // ── 6. Build markdown ───────────────────────────────────────────────────────
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  md(`# Solo Tournament Scenario — Results`);
  md(`_Generated: ${ts}_\n`);

  md(`## Tournament`);
  md(`| Field | Value |`);
  md(`|---|---|`);
  md(`| ID | \`${tId}\` |`);
  md(`| Name | ${tournament.name} |`);
  md(`| Format | Open (solo) |`);
  md(`| Sessions | 10 |`);
  md(`| Games / session | 3 |`);
  md(`| Handicap base | 220 @ 90% |`);
  md(`| Ranking | Pins |`);
  md(``);

  md(`## Players`);
  md(`| # | Name | ID |`);
  md(`|---|---|---|`);
  players.forEach((p, i) => md(`| ${i + 1} | ${p.name} | \`${p.id}\` |`));
  md(``);

  md(`## Raw Scores Submitted`);
  md(`_G1 / G2 / G3 per session (no handicap)_\n`);
  const hdr = `| Player | ${Array.from({length:10},(_,i)=>`S${i+1}`).join(' | ')} |`;
  const sep = `|---|${Array.from({length:10},()=>'---|').join('')}`;
  md(hdr);
  md(sep);
  for (const player of players) {
    const cols = Array.from({length:10}, (_, i) => {
      const s = scoreMatrix[player.id]?.[i + 1];
      return s ? `${s.g1}·${s.g2}·${s.g3}` : '—';
    });
    md(`| ${player.name} | ${cols.join(' | ')} |`);
  }
  md(``);

  md(`## Standings — GET /tournaments/:id/standings`);
  if (Array.isArray(standings) && standings.length > 0) {
    const cols = Object.keys(standings[0]);
    md(`| ${cols.join(' | ')} |`);
    md(`| ${cols.map(() => '---').join(' | ')} |`);
    standings.forEach(row => md(`| ${cols.map(c => row[c] ?? '—').join(' | ')} |`));
  } else {
    md(`\`\`\`json\n${JSON.stringify(standings, null, 2)}\n\`\`\``);
  }
  md(``);

  md(`## All-Player Statistics — GET /tournaments/:id/player-statistics`);
  if (Array.isArray(allStats) && allStats.length > 0) {
    const cols = Object.keys(allStats[0]);
    md(`| ${cols.join(' | ')} |`);
    md(`| ${cols.map(() => '---').join(' | ')} |`);
    allStats.forEach(row => md(`| ${cols.map(c => row[c] ?? '—').join(' | ')} |`));
  } else {
    md(`\`\`\`json\n${JSON.stringify(allStats, null, 2)}\n\`\`\``);
  }
  md(``);

  md(`## Deep-Dive: ${players[0].name} — GET /tournaments/:id/players/:playerId/statistics`);
  md(`\`\`\`json`);
  md(JSON.stringify(p0Stats, null, 2));
  md(`\`\`\``);
  md(``);

  md(`## Session Scores Leaderboard — GET /tournaments/:id/scores`);
  md(`_First 20 rows shown (${Array.isArray(scores) ? scores.length : '?'} total)_\n`);
  if (Array.isArray(scores) && scores.length > 0) {
    const cols = Object.keys(scores[0]);
    md(`| ${cols.join(' | ')} |`);
    md(`| ${cols.map(() => '---').join(' | ')} |`);
    scores.slice(0, 20).forEach(row => md(`| ${cols.map(c => row[c] ?? '—').join(' | ')} |`));
    if (scores.length > 20) md(`\n_…and ${scores.length - 20} more rows_`);
  } else {
    md(`\`\`\`json\n${JSON.stringify(scores, null, 2)}\n\`\`\``);
  }

  // ── 7. Write file ───────────────────────────────────────────────────────────
  const fs   = require('fs');
  const path = require('path');
  const dir  = path.join(__dirname, '..', 'docs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const outPath = path.join(dir, 'solo-scenario-results.md');
  fs.writeFileSync(outPath, lines.join('\n'));
  log(`\nResults written to ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
