import { describe, expect, it } from 'vitest';
import { addCompletedGame, averageScore, EMPTY_STATISTICS } from '../src/stats';

describe('game statistics', () => {
  it('accumulates completed games and computes an average', () => {
    const first = addCompletedGame(EMPTY_STATISTICS, {
      id: 'classic:1',
      score: 900,
      highestCombo: 3,
      lines: 8,
    });
    const second = addCompletedGame(first, {
      id: 'duo:room-1',
      score: 1_100,
      highestCombo: 5,
      lines: 12,
      duoWin: true,
    });

    expect(second).toMatchObject({
      gamesPlayed: 2,
      highestCombo: 5,
      totalLines: 20,
      totalScore: 2_000,
      duoWins: 1,
    });
    expect(averageScore(second)).toBe(1_000);
  });

  it('does not count the same completed game twice', () => {
    const game = { id: 'classic:7', score: 400, highestCombo: 2, lines: 3 };
    const once = addCompletedGame(EMPTY_STATISTICS, game);

    expect(addCompletedGame(once, game)).toBe(once);
  });

  it('reports a zero average before any games are finished', () => {
    expect(averageScore(EMPTY_STATISTICS)).toBe(0);
  });
});
