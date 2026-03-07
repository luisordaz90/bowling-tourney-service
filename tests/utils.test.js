// tests/utils.test.js
// Unit tests for pure helper functions — no database required.
const {
  generateRoundRobinSchedule,
  validateRoundRobinSchedule,
  toCamelCase,
  validateScore,
} = require('../utils/helpers');

describe('generateRoundRobinSchedule', () => {
  it('generates correct session/match counts for an even number of teams', () => {
    const teams = [
      { id: '1', name: 'Alpha' },
      { id: '2', name: 'Beta' },
      { id: '3', name: 'Gamma' },
      { id: '4', name: 'Delta' },
    ];

    const schedule = generateRoundRobinSchedule(teams);

    // 4 teams → 3 sessions, 2 matches per session
    expect(schedule).toHaveLength(3);
    schedule.forEach(session => expect(session.matches).toHaveLength(2));

    // No validation issues
    const issues = validateRoundRobinSchedule(schedule, teams.length);
    expect(issues).toHaveLength(0);
  });

  it('handles an odd number of teams by inserting a BYE slot', () => {
    const teams = [
      { id: '1', name: 'Alpha' },
      { id: '2', name: 'Beta' },
      { id: '3', name: 'Gamma' },
    ];

    const schedule = generateRoundRobinSchedule(teams);

    // 3 teams → 3 sessions, 1 match per session + 1 BYE team
    expect(schedule).toHaveLength(3);
    schedule.forEach(session => {
      expect(session.matches).toHaveLength(1);
      expect(session.byeTeam).not.toBeNull();
    });

    // Every team gets a BYE exactly once
    const byeTeamIds = schedule.map(s => s.byeTeam.id);
    expect(new Set(byeTeamIds).size).toBe(3);
  });
});

describe('toCamelCase', () => {
  it('converts snake_case keys recursively, including nested objects and arrays', () => {
    const input = {
      tournament_id: 'abc',
      home_team: {
        team_name: 'Strikers',
        total_score: 620,
      },
      player_scores: [
        { game_one: 180, high_game: true },
      ],
    };

    const result = toCamelCase(input);

    expect(result.tournamentId).toBe('abc');
    expect(result.homeTeam.teamName).toBe('Strikers');
    expect(result.homeTeam.totalScore).toBe(620);
    expect(result.playerScores[0].gameOne).toBe(180);
    expect(result.playerScores[0].highGame).toBe(true);
  });
});

describe('validateScore', () => {
  it('accepts boundary values 0 and 300, rejects out-of-range values', () => {
    expect(validateScore(0)).toBe(true);
    expect(validateScore(300)).toBe(true);
    expect(validateScore(150)).toBe(true);
    expect(validateScore(-1)).toBe(false);
    expect(validateScore(301)).toBe(false);
  });
});
