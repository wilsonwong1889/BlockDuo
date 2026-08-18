import { describe, expect, it } from 'vitest';
import { cleanName, FALLBACK_NAME, isAllowedName, listedName, normalizeName } from '../src/names';

describe('name moderation', () => {
  it('allows ordinary names', () => {
    for (const name of ['willywong', 'Emanda', 'Ben', 'yhhh', 'Ada + Bo', 'Zoë', '山田']) {
      expect(isAllowedName(name)).toBe(true);
    }
  });

  it('does not ban innocent words that merely contain a rude one', () => {
    // The mistake every naive filter makes. Each of these is a real name or
    // word that a substring match would refuse.
    for (const name of [
      'Scunthorpe',
      'classic',
      'bass',
      'assassin',
      'Cockburn',
      'Dickinson',
      'grape',
      'therapist',
      'analysis',
      'Shitake',
    ]) {
      expect(isAllowedName(name)).toBe(true);
    }
  });

  it('refuses slurs wherever they are hidden', () => {
    for (const name of ['xxnigger', 'faggot99', 'a retard b']) {
      expect(isAllowedName(name)).toBe(false);
    }
  });

  it('refuses rude words standing on their own', () => {
    for (const name of ['fuck', 'Shit', 'ass', 'twat', 'big fuck man']) {
      expect(isAllowedName(name)).toBe(false);
    }
  });

  it('sees through lookalike characters', () => {
    for (const name of ['sh1t', 'f4ggot', 'n1gger', '$hit', 'fu(k'.replace('(', 'c')]) {
      expect(isAllowedName(name)).toBe(false);
    }
  });

  it('sees through separators used to break a word up', () => {
    for (const name of ['f u c k', 'f-u-c-k', 's h i t']) {
      expect(isAllowedName(name)).toBe(false);
    }
  });
});

describe('cleanName', () => {
  it('trims, caps and never returns nothing', () => {
    expect(cleanName('  Ada  ')).toBe('Ada');
    expect(cleanName('x'.repeat(50))).toHaveLength(20);
    expect(cleanName('   ')).toBe(FALLBACK_NAME);
    expect(cleanName(undefined)).toBe(FALLBACK_NAME);
    expect(cleanName(42)).toBe(FALLBACK_NAME);
  });

  it('strips control characters rather than storing them', () => {
    expect(cleanName('Ada\u0000\u001fBo')).toBe('AdaBo');
  });

  it('falls back rather than storing a name nobody should see', () => {
    expect(cleanName('fuck')).toBe(FALLBACK_NAME);
    expect(cleanName('n1gger')).toBe(FALLBACK_NAME);
  });
});

describe('normalizeName', () => {
  it('folds case and lookalikes', () => {
    expect(normalizeName('H3LL0')).toBe('hello');
    expect(normalizeName('$T4R')).toBe('star');
  });
});

describe('listedName', () => {
  it('tells one unnamed player from the next by their code', () => {
    expect(listedName('Player', 'BD-K3M9XQ2P')).toBe('Player BD-K3M9XQ2P');
    // A name that was refused, or was never there at all, is the fallback too.
    expect(listedName('', 'BD-K3M9XQ2P')).toBe('Player BD-K3M9XQ2P');
    expect(listedName('fuck', 'BD-K3M9XQ2P')).toBe('Player BD-K3M9XQ2P');
  });

  it('leaves a chosen name exactly as it is', () => {
    expect(listedName('Ada', 'BD-K3M9XQ2P')).toBe('Ada');
    expect(listedName('Player One', 'BD-K3M9XQ2P')).toBe('Player One');
  });

  it('says the plain fallback when there is no code to add', () => {
    expect(listedName('Player', '')).toBe(FALLBACK_NAME);
  });
});
