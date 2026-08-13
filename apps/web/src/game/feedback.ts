import {
  SCORING,
  getPiece,
  streakMultiplier,
  type Clears,
  type GameEvent,
  type GameState,
} from '@blokduo/engine';

export type ChainTier = 0 | 1 | 2 | 3 | 4;

export interface MoveFeedback {
  placementPoints: number;
  lines: number;
  clearPoints: number;
  streakBefore: number;
  streakAfter: number;
  multiplier: number;
  perfectPoints: number;
  gameOver: boolean;
}

/** Fields available on both current and pre-events Duo `applied` messages. */
export interface AppliedFeedbackFields {
  slot: number;
  row: number;
  col: number;
  clears: Clears | null;
  scoreDelta: number;
  perfect: boolean;
  events?: GameEvent[];
}

/**
 * Return the server's exact events when available. During a rolling deploy an
 * older room Worker can still send the previous `applied` shape, so rebuild the
 * feedback-bearing events from its authoritative before/after snapshots.
 */
export function eventsForAppliedFeedback(
  before: GameState,
  after: GameState,
  applied: AppliedFeedbackFields,
): GameEvent[] {
  if (applied.events !== undefined) return applied.events;

  const events: GameEvent[] = [];
  const held = before.hand[applied.slot];
  let placedCells = 0;
  if (held) {
    try {
      placedCells = getPiece(held.pieceId).cells.length;
    } catch {
      // A stale/corrupt snapshot should lose detail, not crash the whole room.
    }
  }
  const placementPoints = placedCells * SCORING.POINTS_PER_CELL;
  events.push({
    type: 'placed',
    slot: applied.slot,
    row: applied.row,
    col: applied.col,
    cells: placedCells,
    points: placementPoints,
  });

  const lines = applied.clears
    ? applied.clears.rows.length + applied.clears.cols.length
    : 0;
  const perfectPoints = applied.perfect ? SCORING.PERFECT_CLEAR : 0;
  const stateDelta = after.score - before.score;
  const totalPoints = Number.isFinite(applied.scoreDelta)
    ? applied.scoreDelta
    : Number.isFinite(stateDelta)
      ? stateDelta
      : 0;

  if (applied.clears && lines > 0) {
    events.push({
      type: 'cleared',
      rows: applied.clears.rows,
      cols: applied.clears.cols,
      cellIndices: applied.clears.cellIndices,
      points: Math.max(0, totalPoints - placementPoints - perfectPoints),
      multiplier: streakMultiplier(before.streak),
    });
    events.push({ type: 'streak', streak: after.streak });
  }

  if (applied.perfect) {
    events.push({ type: 'perfect', points: perfectPoints });
  }

  const usedLastPiece =
    before.hand.filter((slot) => slot !== null).length === 1 &&
    before.hand[applied.slot] !== null;
  if (usedLastPiece && after.hand.every((slot) => slot !== null)) {
    events.push({ type: 'refill' });
  }
  if (after.over) events.push({ type: 'gameover', score: after.score });

  return events;
}

/** One semantic description drives sound, colour, haptics, and copy in both modes. */
export function feedbackFromEvents(before: GameState, events: GameEvent[]): MoveFeedback {
  const placed = events.find((event) => event.type === 'placed');
  const cleared = events.find((event) => event.type === 'cleared');
  const streak = events.find((event) => event.type === 'streak');
  const perfect = events.find((event) => event.type === 'perfect');

  return {
    placementPoints: placed?.type === 'placed' ? placed.points : 0,
    lines:
      cleared?.type === 'cleared' ? cleared.rows.length + cleared.cols.length : 0,
    clearPoints: cleared?.type === 'cleared' ? cleared.points : 0,
    streakBefore: before.streak,
    streakAfter: streak?.type === 'streak' ? streak.streak : 0,
    multiplier: cleared?.type === 'cleared' ? cleared.multiplier : 1,
    perfectPoints: perfect?.type === 'perfect' ? perfect.points : 0,
    gameOver: events.some((event) => event.type === 'gameover'),
  };
}

export function chainTier(streak: number): ChainTier {
  if (streak <= 0) return 0;
  if (streak === 1) return 1;
  if (streak <= 3) return 2;
  if (streak <= 5) return 3;
  return 4;
}

export function chainCallout(streak: number, lines: number): string {
  if (streak >= 6) return `OVERDRIVE ×${streak}`;
  if (streak >= 4) return `ON FIRE ×${streak}`;
  if (streak >= 2) return `COMBO ×${streak}`;
  if (lines >= 3) return `${lines} LINE BLAST`;
  if (lines === 2) return 'DOUBLE LINE';
  return 'LINE CLEAR';
}

export function feedbackText(feedback: MoveFeedback): string {
  return `${chainCallout(feedback.streakAfter, feedback.lines)} · +${feedback.clearPoints}`;
}
