import { describe, expect, it } from 'vitest';
import { normalizedHash, parseHash } from '../src/routes';

describe('parseHash', () => {
  it('reads the plain classic route as a resumed game', () => {
    expect(parseHash('#/classic')).toEqual({ name: 'classic', fresh: false });
  });

  it('reads /new as a request for a fresh board', () => {
    expect(parseHash('#/classic/new')).toEqual({ name: 'classic', fresh: true });
  });

  it('ignores any other classic argument', () => {
    expect(parseHash('#/classic/whatever')).toEqual({ name: 'classic', fresh: false });
  });

  it('uppercases a duo invite code', () => {
    expect(parseHash('#/duo/ab12cd')).toEqual({ name: 'duo', code: 'AB12CD' });
  });

  it('treats duo without a code as the lobby', () => {
    expect(parseHash('#/duo')).toEqual({ name: 'duo', code: undefined });
  });

  it('reads a player profile, with and without a code', () => {
    expect(parseHash('#/player/bd-abc123')).toEqual({ name: 'player', code: 'BD-ABC123' });
    expect(parseHash('#/player')).toEqual({ name: 'player', code: undefined });
  });

  it('falls back to home for an empty or unknown hash', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/nowhere')).toEqual({ name: 'home' });
  });

  it('tolerates a hash written without the leading slash', () => {
    expect(parseHash('#classic/new')).toEqual({ name: 'classic', fresh: true });
    expect(parseHash('#social')).toEqual({ name: 'social' });
  });
});

describe('normalizedHash', () => {
  it('drops the one-shot new-game instruction', () => {
    expect(normalizedHash({ name: 'classic', fresh: true })).toBe('#/classic');
  });

  it('round-trips to a route that no longer starts a new game', () => {
    expect(parseHash(normalizedHash({ name: 'classic', fresh: true }))).toEqual({
      name: 'classic',
      fresh: false,
    });
  });

  it('keeps a duo room in the URL so the link stays shareable', () => {
    expect(normalizedHash({ name: 'duo', code: 'AB12CD' })).toBe('#/duo/AB12CD');
    expect(normalizedHash({ name: 'duo' })).toBe('#/duo');
  });

  it('maps the remaining routes to their own paths', () => {
    expect(normalizedHash({ name: 'social' })).toBe('#/social');
    expect(normalizedHash({ name: 'home' })).toBe('#/');
  });
});
