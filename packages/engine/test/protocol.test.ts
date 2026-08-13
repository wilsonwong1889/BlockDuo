import { describe, expect, it } from 'vitest';
import {
  CODE_LENGTH,
  DEFAULT_DUO_MODE,
  DUO_TURN_MS,
  duoModeRanks,
  isDuoMode,
  isValidRoomCode,
  randomRoomCode,
} from '../src/protocol';

describe('duo modes', () => {
  it('gives Classic a minute to think and Ranked five seconds', () => {
    expect(DUO_TURN_MS.classic).toBe(60_000);
    expect(DUO_TURN_MS.ranked).toBe(5_000);
  });

  it('ranks only the fast mode', () => {
    expect(duoModeRanks('ranked')).toBe(true);
    expect(duoModeRanks('classic')).toBe(false);
  });

  it('opens on the relaxed mode, so an unspecified room is never the harsh one', () => {
    expect(DEFAULT_DUO_MODE).toBe('classic');
  });

  it('recognises only the two real modes', () => {
    expect(isDuoMode('classic')).toBe(true);
    expect(isDuoMode('ranked')).toBe(true);
    for (const value of ['Ranked', 'blitz', '', null, undefined, 5_000, {}]) {
      expect(isDuoMode(value)).toBe(false);
    }
  });
});

describe('room codes', () => {
  it('mints codes that validate', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = randomRoomCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('rejects the characters that are misread aloud', () => {
    expect(isValidRoomCode('ABC0DE')).toBe(false);
    expect(isValidRoomCode('ABCIDE')).toBe(false);
    expect(isValidRoomCode('abc123')).toBe(false);
    expect(isValidRoomCode('ABC12')).toBe(false);
  });
});
