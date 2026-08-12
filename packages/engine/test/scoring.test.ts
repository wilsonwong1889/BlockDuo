import { describe, expect, it } from 'vitest';
import { SCORING, clearScore, streakMultiplier } from '../src/scoring.js';

describe('streakMultiplier', () => {
  it('starts at 1x with no streak', () => {
    expect(streakMultiplier(0)).toBe(1);
  });

  it('grows by STREAK_STEP per consecutive clearing move', () => {
    expect(streakMultiplier(1)).toBe(1.5);
    expect(streakMultiplier(2)).toBe(2);
    expect(streakMultiplier(4)).toBe(3);
  });

  it('is capped', () => {
    expect(streakMultiplier(100)).toBe(SCORING.STREAK_MAX);
  });
});

describe('clearScore', () => {
  it('is zero when nothing clears', () => {
    expect(clearScore(0, 0)).toBe(0);
    expect(clearScore(0, 5)).toBe(0);
  });

  it('pays the base rate for a lone single clear', () => {
    expect(clearScore(1, 0)).toBe(10);
  });

  it('rewards multi-line clears superlinearly', () => {
    expect(clearScore(2, 0)).toBe(2 * 10 + 20); // 40
    expect(clearScore(3, 0)).toBe(3 * 10 + 60); // 90
    expect(clearScore(4, 0)).toBe(4 * 10 + 120); // 160

    // Four at once must beat four separate single clears, even on a streak.
    const separate = clearScore(1, 0) + clearScore(1, 1) + clearScore(1, 2) + clearScore(1, 3);
    expect(clearScore(4, 0)).toBeGreaterThan(separate);
  });

  it('applies the streak multiplier on top', () => {
    expect(clearScore(4, 2)).toBe(Math.round((4 * 10 + 120) * 2));
  });

  it('clamps the bonus table for absurd line counts', () => {
    expect(() => clearScore(16, 0)).not.toThrow();
    expect(clearScore(16, 0)).toBeGreaterThan(0);
  });
});
