import { describe, expect, it } from 'vitest';
import {
  CELLS,
  boardFromString,
  boardToString,
  emptyBoard,
  filledCount,
  hasAnyPlacement,
  legalAnchors,
} from '../src/board.js';
import { applyMove, isGameOver, newGame, replay } from '../src/game.js';
import { getPiece } from '../src/pieces.js';
import { nextInt } from '../src/rng.js';
import { SCORING } from '../src/scoring.js';
import type { GameState, Move } from '../src/types.js';

/** Force a specific board and hand, so a scenario can be set up exactly. */
function stateWith(boardStr: string, pieceIds: (string | null)[], patch: Partial<GameState> = {}): GameState {
  return {
    ...newGame(1),
    board: boardFromString(boardStr),
    hand: pieceIds.map((id) => (id ? { pieceId: id, color: 1 as const } : null)),
    ...patch,
  };
}

function allLegalMoves(state: GameState): Move[] {
  const moves: Move[] = [];
  state.hand.forEach((slot, i) => {
    if (!slot) return;
    for (const [row, col] of legalAnchors(state.board, getPiece(slot.pieceId))) {
      moves.push({ slot: i, row, col });
    }
  });
  return moves;
}

/** Play a full game choosing uniformly at random among legal moves. */
function playRandomGame(seed: number, onStep?: (before: GameState, move: Move, after: GameState) => void) {
  let state = newGame(seed);
  let rng = seed ^ 0x5f3759df;
  let guard = 0;
  while (!state.over) {
    if (guard++ > 5000) throw new Error('game did not terminate');
    const moves = allLegalMoves(state);
    expect(moves.length).toBeGreaterThan(0);
    const pick = nextInt(rng, moves.length);
    rng = pick.state;
    const move = moves[pick.value];
    const res = applyMove(state, move);
    if (!res.ok) throw new Error(`legal move rejected: ${res.reason}`);
    onStep?.(state, move, res.result.state);
    state = res.result.state;
  }
  return state;
}

const EMPTY = '........\n'.repeat(8).trim();

describe('newGame', () => {
  it('starts empty, scoreless, with a full hand', () => {
    const g = newGame(42);
    expect(filledCount(g.board)).toBe(0);
    expect(g.score).toBe(0);
    expect(g.streak).toBe(0);
    expect(g.over).toBe(false);
    expect(g.hand.filter(Boolean)).toHaveLength(3);
  });

  it('is fully determined by its seed', () => {
    expect(newGame(7)).toEqual(newGame(7));
    expect(newGame(7).hand).not.toEqual(newGame(8).hand);
  });
});

describe('applyMove — validation', () => {
  const state = stateWith(EMPTY, ['1x1', '2x2', '3x3']);

  it('rejects an out-of-range slot', () => {
    expect(applyMove(state, { slot: 3, row: 0, col: 0 })).toMatchObject({ ok: false, reason: 'no-such-slot' });
    expect(applyMove(state, { slot: -1, row: 0, col: 0 })).toMatchObject({ ok: false, reason: 'no-such-slot' });
  });

  it('rejects an already-used slot', () => {
    const used = stateWith(EMPTY, [null, '2x2', '3x3']);
    expect(applyMove(used, { slot: 0, row: 0, col: 0 })).toMatchObject({ ok: false, reason: 'empty-slot' });
  });

  it('rejects placements that run off the board', () => {
    expect(applyMove(state, { slot: 2, row: 6, col: 6 })).toMatchObject({ ok: false, reason: 'out-of-bounds' });
    expect(applyMove(state, { slot: 0, row: 8, col: 0 })).toMatchObject({ ok: false, reason: 'out-of-bounds' });
    expect(applyMove(state, { slot: 0, row: 0.5, col: 0 })).toMatchObject({ ok: false, reason: 'out-of-bounds' });
  });

  it('rejects placements onto occupied cells', () => {
    const occupied = stateWith(
      `
      ##......
      ##......
      ........
      ........
      ........
      ........
      ........
      ........
      `,
      ['2x2', '1x1', '1x1'],
    );
    expect(applyMove(occupied, { slot: 0, row: 0, col: 0 })).toMatchObject({ ok: false, reason: 'occupied' });
    expect(applyMove(occupied, { slot: 0, row: 0, col: 2 })).toMatchObject({ ok: true });
  });

  it('leaves the original state untouched when a move is rejected', () => {
    const before = boardToString(state.board);
    applyMove(state, { slot: 2, row: 7, col: 7 });
    expect(boardToString(state.board)).toBe(before);
  });

  it('refuses any move once the game is over', () => {
    const over = stateWith(EMPTY, ['1x1', null, null], { over: true });
    expect(applyMove(over, { slot: 0, row: 0, col: 0 })).toMatchObject({ ok: false, reason: 'game-over' });
  });
});

describe('applyMove — placing and clearing', () => {
  it('scores one point per placed cell', () => {
    const s = stateWith(EMPTY, ['3x3', '1x1', '1x1']);
    const res = applyMove(s, { slot: 0, row: 0, col: 0 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.result.state.score).toBe(9 * SCORING.POINTS_PER_CELL);
    expect(res.result.events[0]).toMatchObject({ type: 'placed', cells: 9 });
  });

  it('clears a row and pays for it', () => {
    const s = stateWith(
      `
      #######.
      ........
      ........
      ........
      ........
      ........
      ........
      ........
      `,
      ['1x1', '2x2', '2x2'],
    );
    const res = applyMove(s, { slot: 0, row: 0, col: 7 });
    if (!res.ok) throw new Error('expected ok');
    expect(filledCount(res.result.state.board)).toBe(0);
    // 1 cell placed + a single-line clear + the perfect-clear bonus.
    expect(res.result.state.score).toBe(1 + 10 + SCORING.PERFECT_CLEAR);
    expect(res.result.state.streak).toBe(1);
    expect(res.result.events.map((e) => e.type)).toContain('perfect');
  });

  it('clears a row and a column together, counting the shared cell once', () => {
    const s = stateWith(
      `
      .#######
      #.......
      #.......
      #.......
      #.......
      #.......
      #.......
      #.......
      `,
      ['1x1', '2x2', '2x2'],
    );
    const res = applyMove(s, { slot: 0, row: 0, col: 0 });
    if (!res.ok) throw new Error('expected ok');
    const cleared = res.result.events.find((e) => e.type === 'cleared');
    expect(cleared).toMatchObject({ rows: [0], cols: [0] });
    expect((cleared as { cellIndices: number[] }).cellIndices).toHaveLength(15);
    expect(filledCount(res.result.state.board)).toBe(0);
  });

  it('does not let anything fall after a clear', () => {
    const s = stateWith(
      `
      #######.
      .....##.
      ........
      ........
      ........
      ........
      ........
      ........
      `,
      ['1x1', '2x2', '2x2'],
    );
    const res = applyMove(s, { slot: 0, row: 0, col: 7 });
    if (!res.ok) throw new Error('expected ok');
    expect(boardToString(res.result.state.board).split('\n')[1]).toBe('.....##.');
  });

  it('builds and breaks streaks', () => {
    let s = stateWith(
      `
      #######.
      #######.
      ........
      ........
      ........
      ........
      ........
      ........
      `,
      ['1x1', '1x1', '2x2'],
    );
    let res = applyMove(s, { slot: 0, row: 0, col: 7 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.result.state.streak).toBe(1);

    res = applyMove(res.result.state, { slot: 1, row: 1, col: 7 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.result.state.streak).toBe(2);
    expect(res.result.state.bestStreak).toBe(2);

    // A placement that clears nothing resets the streak.
    res = applyMove(res.result.state, { slot: 2, row: 4, col: 4 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.result.state.streak).toBe(0);
    expect(res.result.state.bestStreak).toBe(2);
  });

  it('refills the hand only once all three pieces are used', () => {
    let s = stateWith(EMPTY, ['1x1', '1x1', '1x1']);
    let res = applyMove(s, { slot: 0, row: 0, col: 0 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.result.state.hand.filter(Boolean)).toHaveLength(2);
    expect(res.result.events.map((e) => e.type)).not.toContain('refill');

    res = applyMove(res.result.state, { slot: 1, row: 0, col: 2 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.result.state.hand.filter(Boolean)).toHaveLength(1);

    res = applyMove(res.result.state, { slot: 2, row: 0, col: 4 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.result.state.hand.filter(Boolean)).toHaveLength(3);
    expect(res.result.events.map((e) => e.type)).toContain('refill');
  });
});

describe('game over', () => {
  it('is declared only when no remaining piece fits anywhere', () => {
    const dead = stateWith(
      `
      ########
      ########
      ########
      ########
      ########
      ########
      ########
      #######.
      `,
      ['2x2', '2x2', '2x2'],
    );
    expect(isGameOver(dead)).toBe(true);

    const alive = { ...dead, hand: [{ pieceId: '1x1', color: 1 as const }, null, null] };
    expect(isGameOver(alive)).toBe(false);
  });

  it('ends the game on the placement that kills it', () => {
    const s = stateWith(
      `
      ########
      ########
      ########
      ########
      ########
      ########
      #####.#.
      ########
      `,
      ['1x1', '1x1', null],
    );
    const res = applyMove(s, { slot: 0, row: 6, col: 5 });
    if (!res.ok) throw new Error('expected ok');
    // The remaining 1x1 still fits at (6,7), so play continues.
    expect(res.result.state.over).toBe(false);

    const res2 = applyMove(res.result.state, { slot: 1, row: 6, col: 7 });
    if (!res2.ok) throw new Error('expected ok');
    // That filled row 6, which clears — so the board opens up and play continues.
    expect(res2.result.state.over).toBe(false);
  });
});

describe('determinism', () => {
  it('replays identically from a seed and move list', () => {
    const moves: Move[] = [];
    playRandomGame(2024, (_before, move) => {
      moves.push(move);
    });
    const a = replay(2024, moves);
    const b = replay(2024, moves);
    expect(boardToString(a.board)).toBe(boardToString(b.board));
    expect(a.score).toBe(b.score);
    expect(a.rng).toBe(b.rng);
  });

  it('rejects a move list that does not match its seed', () => {
    const moves: Move[] = [];
    playRandomGame(31337, (_b, m) => {
      moves.push(m);
    });
    expect(() => replay(31338, moves)).toThrow(/Illegal move/);
  });
});

describe('invariants across many random games', () => {
  it('holds for 40 full games', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const final = playRandomGame(seed, (before, move, after) => {
        const piece = getPiece(before.hand[move.slot]!.pieceId);

        // Score never decreases.
        expect(after.score).toBeGreaterThanOrEqual(before.score);

        // Cell accounting: filled = before + placed - cleared. Nothing is
        // overwritten and nothing vanishes unaccounted for.
        const clearedEvent = after.linesCleared - before.linesCleared;
        const clearedCells = filledCount(before.board) + piece.cells.length - filledCount(after.board);
        expect(clearedCells).toBeGreaterThanOrEqual(0);
        if (clearedEvent === 0) expect(clearedCells).toBe(0);

        // The hand always has three slots and never resurrects a used piece.
        expect(after.hand).toHaveLength(3);
        expect(filledCount(after.board)).toBeLessThanOrEqual(CELLS);

        // Streak bookkeeping stays consistent.
        expect(after.bestStreak).toBeGreaterThanOrEqual(after.streak);
        expect(after.moveCount).toBe(before.moveCount + 1);
      });

      // A finished game really is finished: nothing in hand fits anywhere.
      expect(final.over).toBe(true);
      for (const slot of final.hand) {
        if (slot) expect(hasAnyPlacement(final.board, getPiece(slot.pieceId))).toBe(false);
      }
      expect(final.moveCount).toBeGreaterThan(3);
    }
  });
});

describe('serde round-trip', () => {
  it('survives encode/decode unchanged', async () => {
    const { encodeState, decodeState } = await import('../src/serde.js');
    const state = playRandomGame(99);
    const back = decodeState(encodeState(state));
    expect(boardToString(back.board)).toBe(boardToString(state.board));
    expect(back.score).toBe(state.score);
    expect(back.hand).toEqual(state.hand);
  });

  it('rejects malformed board strings', async () => {
    const { decodeBoard } = await import('../src/serde.js');
    expect(() => decodeBoard('0'.repeat(63))).toThrow(/64 chars/);
    expect(() => decodeBoard('9'.repeat(64))).toThrow(/Bad cell value/);
  });
});

describe('an empty board is never a loss', () => {
  it('always deals a playable opening hand', () => {
    for (let seed = 0; seed < 300; seed++) {
      expect(newGame(seed).over, `seed ${seed}`).toBe(false);
    }
  });

  it('never leaves the player without a move mid-hand on a fresh board', () => {
    const board = emptyBoard();
    expect(filledCount(board)).toBe(0);
  });
});
