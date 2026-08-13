import { describe, expect, it } from 'vitest';
import { GAME_SEED_RANGE } from '@blokduo/engine';
import { shouldDiscardPendingClassic } from '../src/progress/retryPolicy';
import { appendPendingClassic, type PendingClassicClaim } from '../src/storage';

describe('pending Classic reward retry policy', () => {
  it('discards permanently rejected legacy transcripts', () => {
    expect(shouldDiscardPendingClassic(123, 400)).toBe(true);
    expect(shouldDiscardPendingClassic(123, 422)).toBe(true);
  });

  it('retains version-tagged transcripts across an older Worker rollback', () => {
    expect(shouldDiscardPendingClassic(GAME_SEED_RANGE + 123, 400)).toBe(false);
  });

  it('still discards unrelated permanent client errors for versioned games', () => {
    expect(shouldDiscardPendingClassic(GAME_SEED_RANGE + 123, 401)).toBe(true);
    expect(shouldDiscardPendingClassic(GAME_SEED_RANGE + 123, 422)).toBe(true);
  });

  it('retains temporary server and network failures for any seed', () => {
    expect(shouldDiscardPendingClassic(123, 0)).toBe(false);
    expect(shouldDiscardPendingClassic(123, 503)).toBe(false);
  });
});

describe('pending Classic reward storage', () => {
  it('retains every distinct unresolved payout instead of evicting older games', () => {
    let pending: PendingClassicClaim[] = [];
    for (let seed = 0; seed < 20; seed++) {
      pending = appendPendingClassic(pending, {
        seed: GAME_SEED_RANGE + seed,
        moves: [{ slot: 0, row: seed % 8, col: 0 }],
      });
    }
    expect(pending).toHaveLength(20);
    expect(pending[0]?.seed).toBe(GAME_SEED_RANGE);
  });

  it('deduplicates a claim without rewriting the list', () => {
    const claim = { seed: 12, moves: [{ slot: 0, row: 0, col: 0 }] };
    const pending = [claim];
    expect(appendPendingClassic(pending, { seed: 12, moves: [...claim.moves] })).toBe(pending);
  });
});
