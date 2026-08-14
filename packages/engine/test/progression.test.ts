import { describe, expect, it } from 'vitest';
import {
  coinReward,
  currentWeek,
  survivalMultiplier,
  utcDayKey,
  weekWindow,
} from '../src/progression.js';

describe('survivalMultiplier', () => {
  it('increases by 0.25 after every 25 completed moves', () => {
    expect(survivalMultiplier(0)).toBe(1);
    expect(survivalMultiplier(24)).toBe(1);
    expect(survivalMultiplier(25)).toBe(1.25);
    expect(survivalMultiplier(49)).toBe(1.25);
    expect(survivalMultiplier(50)).toBe(1.5);
    expect(survivalMultiplier(75)).toBe(1.75);
    expect(survivalMultiplier(100)).toBe(2);
  });

  it('stays capped at 2x', () => {
    expect(survivalMultiplier(125)).toBe(2);
    expect(survivalMultiplier(Number.MAX_SAFE_INTEGER)).toBe(2);
  });

  it('safely normalises invalid and fractional move counts', () => {
    expect(survivalMultiplier(-25)).toBe(1);
    expect(survivalMultiplier(Number.NaN)).toBe(1);
    expect(survivalMultiplier(Number.POSITIVE_INFINITY)).toBe(1);
    expect(survivalMultiplier(49.999)).toBe(1.25);
  });
});

describe('coinReward', () => {
  it('converts score to base coins 1:1 and adds the survival bonus', () => {
    expect(coinReward(1_001, 0)).toEqual({
      score: 1_001,
      moveCount: 0,
      baseCoins: 1_001,
      multiplier: 1,
      bonusCoins: 0,
      totalCoins: 1_001,
    });

    expect(coinReward(1_001, 25)).toEqual({
      score: 1_001,
      moveCount: 25,
      baseCoins: 1_001,
      multiplier: 1.25,
      bonusCoins: 250,
      totalCoins: 1_251,
    });
  });

  it('floors the total award to whole coins', () => {
    expect(coinReward(3, 25).totalCoins).toBe(3);
    expect(coinReward(7, 75).totalCoins).toBe(12);
  });

  it('normalises bad economy inputs without producing negative or non-finite coins', () => {
    expect(coinReward(-100, -1)).toMatchObject({
      score: 0,
      moveCount: 0,
      baseCoins: 0,
      bonusCoins: 0,
      totalCoins: 0,
    });
    expect(coinReward(Number.NaN, Number.NaN).totalCoins).toBe(0);
    expect(coinReward(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY).totalCoins).toBe(0);
    expect(coinReward(10.9, 25.9)).toMatchObject({
      score: 10,
      moveCount: 25,
      totalCoins: 12,
    });
  });

  it('keeps awards inside JavaScript safe-integer bounds', () => {
    expect(coinReward(Number.MAX_SAFE_INTEGER, 100).totalCoins).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('weekWindow', () => {
  it('uses an inclusive Monday and exclusive next-Monday UTC boundary', () => {
    const monday = Date.parse('2026-08-10T00:00:00.000Z');
    const week = weekWindow(monday);

    expect(week).toEqual({
      key: '2026-08-10',
      start: monday,
      end: Date.parse('2026-08-17T00:00:00.000Z'),
    });
    expect(weekWindow(Date.parse('2026-08-16T23:59:59.999Z'))).toEqual(week);
    expect(weekWindow(week.end).key).toBe('2026-08-17');
  });

  it('handles UTC day boundaries independently of an input Date string offset', () => {
    const week = weekWindow(new Date('2026-08-09T18:30:00-06:00'));
    expect(week.key).toBe('2026-08-10');
  });

  it('handles year boundaries', () => {
    const week = weekWindow(Date.parse('2027-01-01T12:00:00.000Z'));
    expect(week.key).toBe('2026-12-28');
    expect(new Date(week.end).toISOString()).toBe('2027-01-04T00:00:00.000Z');
  });

  it('rejects invalid timestamps', () => {
    expect(() => weekWindow(Number.NaN)).toThrow(RangeError);
    expect(() => weekWindow(new Date(Number.NaN))).toThrow(RangeError);
  });

  it('also exposes currentWeek as a readable alias', () => {
    expect(currentWeek(Date.parse('2026-08-12T12:00:00.000Z'))).toEqual(
      weekWindow(Date.parse('2026-08-12T12:00:00.000Z')),
    );
  });
});

describe('utcDayKey', () => {
  it('names the day a moment falls in', () => {
    expect(utcDayKey(Date.parse('2026-08-14T12:00:00Z'))).toBe('2026-08-14');
  });

  it('turns over at midnight UTC, not at either edge of it', () => {
    expect(utcDayKey(Date.parse('2026-08-14T23:59:59.999Z'))).toBe('2026-08-14');
    expect(utcDayKey(Date.parse('2026-08-15T00:00:00.000Z'))).toBe('2026-08-15');
  });

  it('gives one answer wherever the player is', () => {
    // The same instant, written in two zones, is still one day's free spin.
    expect(utcDayKey(Date.parse('2026-08-14T20:00:00-06:00'))).toBe(
      utcDayKey(Date.parse('2026-08-15T02:00:00Z')),
    );
  });
});
