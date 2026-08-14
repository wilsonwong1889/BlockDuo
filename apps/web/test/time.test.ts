import { describe, expect, it } from 'vitest';
import { timeAgo } from '../src/time';

const NOW = Date.parse('2026-08-14T12:00:00Z');
const ago = (ms: number) => timeAgo(NOW - ms, NOW);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('timeAgo', () => {
  it('treats anything inside the last minute as now', () => {
    expect(ago(0)).toBe('just now');
    expect(ago(59_000)).toBe('just now');
  });

  it('counts minutes and hours, singular and plural', () => {
    expect(ago(MINUTE)).toBe('1 minute ago');
    expect(ago(5 * MINUTE)).toBe('5 minutes ago');
    expect(ago(HOUR)).toBe('1 hour ago');
    expect(ago(3 * HOUR)).toBe('3 hours ago');
  });

  it('names yesterday rather than counting it', () => {
    expect(ago(DAY)).toBe('yesterday');
    expect(ago(2 * DAY)).toBe('2 days ago');
    expect(ago(29 * DAY)).toBe('29 days ago');
  });

  it('falls back to a month once the day has stopped mattering', () => {
    expect(ago(200 * DAY)).toMatch(/\d{4}$/);
  });

  it('does not report the future as a long time ago', () => {
    expect(timeAgo(NOW + HOUR, NOW)).toBe('just now');
  });

  it('survives a nonsense timestamp instead of rendering NaN', () => {
    expect(timeAgo(Number.NaN, NOW)).toBe('unknown');
  });
});
