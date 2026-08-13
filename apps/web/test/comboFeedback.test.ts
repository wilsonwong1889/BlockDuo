import { describe, expect, it } from 'vitest';
import {
  SCORING,
  applyMove,
  boardFromString,
  newGame,
  type GameEvent,
  type GameState,
  type Move,
} from '@blokduo/engine';
import {
  chainCallout,
  chainTier,
  eventsForAppliedFeedback,
  feedbackFromEvents,
  feedbackText,
} from '../src/game/feedback';
import { clearSoundPlan } from '../src/audio/sfx';

function clearState(streak = 0): GameState {
  return {
    ...newGame(1),
    board: boardFromString(`
      #######.
      ........
      ........
      ........
      ........
      ........
      ........
      ........
    `),
    hand: [{ pieceId: '1x1', color: 2 }, null, null],
    streak,
  };
}

function legacyApplied(before: GameState, after: GameState, events: GameEvent[], move: Move) {
  const cleared = events.find((event) => event.type === 'cleared');
  return {
    ...move,
    clears:
      cleared?.type === 'cleared'
        ? {
            rows: cleared.rows,
            cols: cleared.cols,
            cellIndices: cleared.cellIndices,
          }
        : null,
    scoreDelta: after.score - before.score,
    perfect: events.some((event) => event.type === 'perfect'),
  };
}

describe('combo feedback', () => {
  it('builds one descriptor from authoritative engine events', () => {
    const before = clearState(1);
    const result = applyMove(before, { slot: 0, row: 0, col: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const feedback = feedbackFromEvents(before, result.result.events);
    expect(feedback).toMatchObject({
      placementPoints: 1,
      lines: 1,
      clearPoints: 15,
      streakBefore: 1,
      streakAfter: 2,
      multiplier: 1.5,
      perfectPoints: SCORING.PERFECT_CLEAR,
    });
    expect(feedbackText(feedback)).toBe('COMBO ×2 · +15');
  });

  it('keeps chain tier boundaries stable and capped', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 100].map(chainTier)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('distinguishes a multi-line burst from a continuing chain', () => {
    expect(chainCallout(1, 2)).toBe('DOUBLE LINE');
    expect(chainCallout(1, 4)).toBe('4 LINE BLAST');
    expect(chainCallout(4, 1)).toBe('ON FIRE ×4');
    expect(chainCallout(9, 1)).toBe('OVERDRIVE ×9');
  });

  it('maps a non-clearing placement to neutral feedback', () => {
    const before = newGame(7);
    const result = applyMove(before, { slot: 0, row: 0, col: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(feedbackFromEvents(before, result.result.events)).toMatchObject({
      lines: 0,
      streakAfter: 0,
      clearPoints: 0,
      perfectPoints: 0,
    });
  });

  it('uses exact applied events unchanged when a current Duo server provides them', () => {
    const before = clearState(1);
    const move = { slot: 0, row: 0, col: 7 };
    const result = applyMove(before, move);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const exact = result.result.events;
    expect(
      eventsForAppliedFeedback(before, result.result.state, {
        ...legacyApplied(before, result.result.state, exact, move),
        events: exact,
      }),
    ).toBe(exact);
  });

  it('reconstructs identical clear, chain, and perfect feedback for legacy Duo messages', () => {
    const before = clearState(1);
    const move = { slot: 0, row: 0, col: 7 };
    const result = applyMove(before, move);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rebuilt = eventsForAppliedFeedback(
      before,
      result.result.state,
      legacyApplied(before, result.result.state, result.result.events, move),
    );

    expect(feedbackFromEvents(before, rebuilt)).toEqual(
      feedbackFromEvents(before, result.result.events),
    );
    expect(rebuilt.map((event) => event.type)).toEqual(
      result.result.events.map((event) => event.type),
    );
    expect(rebuilt.find((event) => event.type === 'cleared')).toEqual(
      result.result.events.find((event) => event.type === 'cleared'),
    );
  });

  it('reconstructs a legacy non-clearing placement without inventing combo feedback', () => {
    const before = newGame(7);
    const move = { slot: 0, row: 0, col: 0 };
    const result = applyMove(before, move);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rebuilt = eventsForAppliedFeedback(
      before,
      result.result.state,
      legacyApplied(before, result.result.state, result.result.events, move),
    );
    expect(rebuilt.map((event) => event.type)).toEqual(['placed']);
    expect(feedbackFromEvents(before, rebuilt)).toEqual(
      feedbackFromEvents(before, result.result.events),
    );
  });
});

describe('combo sound plan', () => {
  it('widens for line bursts and rises through the chain', () => {
    expect(clearSoundPlan(1, 1).intervals).toHaveLength(2);
    expect(clearSoundPlan(4, 1).intervals).toHaveLength(5);
    expect(clearSoundPlan(1, 4).root).toBeGreaterThan(clearSoundPlan(1, 1).root);
  });

  it('caps pitch and voice count while adding high-chain shimmer', () => {
    expect(clearSoundPlan(99, 99)).toEqual(clearSoundPlan(99, 6));
    expect(clearSoundPlan(99, 99).intervals).toHaveLength(5);
    expect(clearSoundPlan(1, 99).shimmer).toBe(true);
  });
});
