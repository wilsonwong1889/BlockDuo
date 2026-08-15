import { describe, expect, it } from 'vitest';
import { formatWait, msUntilUtcMidnight, timeAgo } from '../src/time';

const NOW = Date.parse('2026-08-14T12:00:00Z');
const ago = (ms: number) => timeAgo(NOW - ms, NOW);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

describe('timeAgo', () => {
  it('treats anything inside the last minute as now', () => {
    expect(ago(0)).toBe('just now');
    expect(ago(59_000)).toBe('just now');
  });

  it('counts in whichever of the five units fits', () => {
    expect(ago(MINUTE)).toBe('1 minute ago');
    expect(ago(HOUR)).toBe('1 hour ago');
    expect(ago(DAY)).toBe('1 day ago');
    expect(ago(WEEK)).toBe('1 week ago');
    expect(ago(MONTH)).toBe('1 month ago');
  });

  it('pluralises past one', () => {
    expect(ago(5 * MINUTE)).toBe('5 minutes ago');
    expect(ago(3 * HOUR)).toBe('3 hours ago');
    expect(ago(2 * DAY)).toBe('2 days ago');
    expect(ago(3 * WEEK)).toBe('3 weeks ago');
    expect(ago(4 * MONTH)).toBe('4 months ago');
  });

  it('always answers in the largest unit that fits', () => {
    expect(ago(90 * MINUTE)).toBe('1 hour ago');
    expect(ago(26 * HOUR)).toBe('1 day ago');
    expect(ago(9 * DAY)).toBe('1 week ago');
    expect(ago(40 * DAY)).toBe('1 month ago');
  });

  it('steps up exactly at each boundary, not before', () => {
    expect(ago(HOUR - 1)).toBe('59 minutes ago');
    expect(ago(DAY - 1)).toBe('23 hours ago');
    expect(ago(WEEK - 1)).toBe('6 days ago');
    expect(ago(MONTH - 1)).toBe('4 weeks ago');
  });

  it('keeps months as the ceiling rather than reaching for years', () => {
    expect(ago(365 * DAY)).toBe('12 months ago');
  });

  it('does not report the future as a long time ago', () => {
    expect(timeAgo(NOW + HOUR, NOW)).toBe('just now');
  });

  it('survives a nonsense timestamp instead of rendering NaN', () => {
    expect(timeAgo(Number.NaN, NOW)).toBe('unknown');
  });
});

describe('waiting for the next free spin', () => {
  it('counts to the next UTC midnight, not the local one', () => {
    // Deliberately a time that is a different date in most of the world: the
    // server stamps the spin with a UTC day, so a local midnight would tell
    // half the players the wrong thing.
    expect(msUntilUtcMidnight(Date.parse('2026-08-14T23:00:00Z'))).toBe(HOUR);
    expect(msUntilUtcMidnight(Date.parse('2026-08-14T00:00:00Z'))).toBe(DAY);
  });

  it('rolls over month and year ends', () => {
    expect(msUntilUtcMidnight(Date.parse('2026-08-31T22:30:00Z'))).toBe(90 * MINUTE);
    expect(msUntilUtcMidnight(Date.parse('2026-12-31T23:00:00Z'))).toBe(HOUR);
  });

  it('never returns a negative wait', () => {
    expect(msUntilUtcMidnight(Number.NaN)).toBe(0);
  });

  it('says the wait in hours and minutes', () => {
    expect(formatWait(7 * HOUR + 23 * MINUTE)).toBe('7h 23m');
    expect(formatWait(HOUR)).toBe('1h 0m');
    expect(formatWait(23 * MINUTE)).toBe('23m');
  });

  it('does not pretend to a precision it is not showing', () => {
    // Anything under a minute would otherwise read as "0m", which looks stuck.
    expect(formatWait(30_000)).toBe('under a minute');
    expect(formatWait(0)).toBe('any moment');
    expect(formatWait(-1)).toBe('any moment');
  });
});
