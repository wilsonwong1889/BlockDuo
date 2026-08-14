import { describe, expect, it } from 'vitest';
import { getPiece, PIECES, canRotate, rotatedPieceId } from '../src/pieces';
import { applyMove, gameSeed, newGame } from '../src/game';
import { hasAnyPlacement, legalAnchors } from '../src/board';
import {
  applyAction,
  canUndo,
  gemCost,
  MAX_UNDOS,
  newSession,
  POWER_COSTS,
  canRevive,
  MAX_REVIVES,
  REVIVE_MIN_PLAYABLE,
  REVIVE_ROWS,
  replayActions,
  wheelSegment,
  WHEEL_SEGMENTS,
  WHEEL_TOTAL_WEIGHT,
  type GameAction,
} from '../src/powers';

const SEED = gameSeed(0x51de51de);

/** The first legal placement on the board, in slot order. */
function firstMove(state = newGame(SEED)) {
  for (let slot = 0; slot < state.hand.length; slot++) {
    const held = state.hand[slot];
    if (!held) continue;
    const anchor = legalAnchors(state.board, getPiece(held.pieceId))[0];
    if (anchor) return { slot, row: anchor[0], col: anchor[1] };
  }
  throw new Error('a fresh board had no legal placement');
}

describe('rotation', () => {
  it('turns every piece into a real piece of the same size', () => {
    for (const piece of PIECES) {
      const turned = getPiece(rotatedPieceId(piece.id));
      expect(turned.cells.length).toBe(piece.cells.length);
      // A quarter turn swaps the bounding box.
      expect([turned.w, turned.h]).toEqual([piece.h, piece.w]);
    }
  });

  it('comes back to where it started after four turns', () => {
    for (const piece of PIECES) {
      let id = piece.id;
      for (let i = 0; i < 4; i++) id = rotatedPieceId(id);
      expect(id).toBe(piece.id);
    }
  });

  it('admits when a piece cannot visibly turn', () => {
    for (const id of ['1x1', '2x2', '3x3']) expect(canRotate(id)).toBe(false);
    for (const id of ['1x5', 'L-0', 'T-0', 'S-0']) expect(canRotate(id)).toBe(true);
  });
});

describe('gem cost', () => {
  it('charges for powers and nothing for playing', () => {
    expect(gemCost([{ slot: 0, row: 0, col: 0 }])).toBe(0);
    expect(gemCost([{ t: 'undo' }])).toBe(POWER_COSTS.undo);
    expect(gemCost([{ t: 'rotate', slot: 1 }])).toBe(POWER_COSTS.rotate);
    expect(gemCost([{ t: 'reroll' }])).toBe(POWER_COSTS.reroll);
    expect(gemCost([{ t: 'undo' }, { t: 'reroll' }, { slot: 0, row: 0, col: 0 }])).toBe(4);
  });
});

describe('the wheel', () => {
  it('has odds that add up to a whole wheel', () => {
    expect(WHEEL_TOTAL_WEIGHT).toBe(100);
  });

  it('lands on each prize across exactly its own slice', () => {
    // Boundaries, not samples: 0-24 is one gem, 25-49 two, 50-74 three,
    // 75-98 ten, and 99 alone is fifty.
    const at = (roll: number) => wheelSegment(roll).gems;
    expect([at(0), at(24)]).toEqual([1, 1]);
    expect([at(25), at(49)]).toEqual([2, 2]);
    expect([at(50), at(74)]).toEqual([3, 3]);
    expect([at(75), at(98)]).toEqual([10, 10]);
    expect(at(99)).toBe(50);
  });

  it('counts one roll in a hundred as the jackpot', () => {
    const jackpots = Array.from({ length: WHEEL_TOTAL_WEIGHT }, (_, i) => wheelSegment(i).gems)
      .filter((gems) => gems === 50).length;
    expect(jackpots).toBe(1);
  });

  it('stays on the wheel for a roll that should not exist', () => {
    for (const roll of [-5, 100, 1e9, Number.NaN]) {
      expect(WHEEL_SEGMENTS).toContainEqual(wheelSegment(roll));
    }
  });
});

describe('undo', () => {
  it('puts the board and the piece back exactly as they were', () => {
    const before = newSession(SEED);
    const move = firstMove(before.state);

    const placed = applyAction(before, move);
    if (!placed.ok) throw new Error('placement rejected');
    expect(placed.session.state.board).not.toEqual(before.state.board);

    const undone = applyAction(placed.session, { t: 'undo' });
    if (!undone.ok) throw new Error('undo rejected');
    expect(undone.session.state).toEqual(before.state);
    expect(undone.session.undosUsed).toBe(1);
  });

  it('runs out after three, however many pieces are placed', () => {
    let session = newSession(SEED);
    const actions: GameAction[] = [];
    for (let i = 0; i < MAX_UNDOS + 1; i++) {
      const move = firstMove(session.state);
      const placed = applyAction(session, move);
      if (!placed.ok) throw new Error('placement rejected');
      session = placed.session;
      actions.push(move);
    }

    for (let i = 0; i < MAX_UNDOS; i++) {
      const undone = applyAction(session, { t: 'undo' });
      if (!undone.ok) throw new Error(`undo ${i + 1} rejected`);
      session = undone.session;
    }

    expect(canUndo(session)).toBe(false);
    const fourth = applyAction(session, { t: 'undo' });
    expect(fourth).toEqual({ ok: false, reason: 'no-undos-left' });
  });

  it('has nothing to reverse before the first placement', () => {
    expect(applyAction(newSession(SEED), { t: 'undo' })).toEqual({
      ok: false,
      reason: 'nothing-to-undo',
    });
  });

  it('takes back a rotation bought after the placement it is reversing', () => {
    const start = newSession(SEED);
    const placed = applyAction(start, firstMove(start.state));
    if (!placed.ok) throw new Error('placement rejected');
    const turned = applyAction(placed.session, { t: 'rotate', slot: 1 });
    if (!turned.ok) throw new Error('rotate rejected');

    const undone = applyAction(turned.session, { t: 'undo' });
    if (!undone.ok) throw new Error('undo rejected');
    // Back to before the placement, so the rotation goes with it.
    expect(undone.session.state).toEqual(start.state);
  });
});

describe('reroll and rotate', () => {
  it('deals a different hand and moves the rng on', () => {
    const start = newSession(SEED);
    const result = applyAction(start, { t: 'reroll' });
    if (!result.ok) throw new Error('reroll rejected');

    expect(result.session.state.rng).not.toBe(start.state.rng);
    expect(result.session.state.board).toEqual(start.state.board);
    expect(result.session.state.score).toBe(start.state.score);
  });

  it('turns only the slot asked for', () => {
    const start = newSession(SEED);
    const result = applyAction(start, { t: 'rotate', slot: 0 });
    if (!result.ok) throw new Error('rotate rejected');

    const before = start.state.hand[0]!;
    expect(result.session.state.hand[0]!.pieceId).toBe(rotatedPieceId(before.pieceId));
    expect(result.session.state.hand[1]).toEqual(start.state.hand[1]);
    expect(result.session.state.hand[2]).toEqual(start.state.hand[2]);
  });

  it('refuses a slot with nothing in it', () => {
    const start = newSession(SEED);
    const placed = applyAction(start, firstMove(start.state));
    if (!placed.ok) throw new Error('placement rejected');
    const emptied = placed.session.state.hand.findIndex((slot) => slot === null);

    expect(applyAction(placed.session, { t: 'rotate', slot: emptied })).toEqual({
      ok: false,
      reason: 'empty-slot',
    });
    expect(applyAction(placed.session, { t: 'rotate', slot: 9 })).toEqual({
      ok: false,
      reason: 'empty-slot',
    });
  });
});

describe('replayActions', () => {
  it('reaches the same state the session did', () => {
    let session = newSession(SEED);
    const actions: GameAction[] = [];
    const run: GameAction[] = [
      firstMove(session.state),
      { t: 'reroll' },
      { t: 'rotate', slot: 0 },
      { t: 'undo' },
    ];
    for (const action of run) {
      const result = applyAction(session, action);
      if (!result.ok) throw new Error(`rejected: ${result.reason}`);
      session = result.session;
      actions.push(action);
    }

    expect(replayActions(SEED, actions)).toEqual(session.state);
  });

  it('still replays a transcript written before powers existed', () => {
    // Untagged entries are placements, so old saved games stay verifiable.
    let state = newGame(SEED);
    const moves = [];
    for (let i = 0; i < 5; i++) {
      const move = firstMove(state);
      const applied = applyMove(state, move);
      if (!applied.ok) throw new Error('placement rejected');
      state = applied.result.state;
      moves.push(move);
    }

    expect(replayActions(SEED, moves)).toEqual(state);
  });

  it('throws on a transcript claiming a fourth undo', () => {
    const session = newSession(SEED);
    const move = firstMove(session.state);
    const actions: GameAction[] = [];
    for (let i = 0; i < MAX_UNDOS + 1; i++) actions.push(move, { t: 'undo' });

    expect(() => replayActions(SEED, actions)).toThrow(/no-undos-left/);
  });

  it('throws on a placement that was never legal', () => {
    expect(() => replayActions(SEED, [{ slot: 0, row: 7, col: 7 }, { slot: 0, row: 7, col: 7 }])).toThrow(
      /Illegal action/,
    );
  });
});

describe('revive', () => {
  /** Play a real game all the way to its end. */
  function playedOut() {
    let session = newSession(SEED);
    while (!session.state.over) {
      const state = session.state;
      let move = null;
      for (let slot = 0; slot < state.hand.length && !move; slot++) {
        const held = state.hand[slot];
        if (!held) continue;
        const anchor = legalAnchors(state.board, getPiece(held.pieceId))[0];
        if (anchor) move = { slot, row: anchor[0], col: anchor[1] };
      }
      if (!move) break;
      const applied = applyAction(session, move);
      if (!applied.ok) throw new Error(applied.reason);
      session = applied.session;
    }
    if (!session.state.over) throw new Error('game did not end');
    return session;
  }

  it('is refused while the game is still going', () => {
    expect(applyAction(newSession(SEED), { t: 'revive' })).toEqual({
      ok: false,
      reason: 'not-over',
    });
  });

  it('always hands back three pieces with at least two that fit', () => {
    // Not one sample: every board a real game can die on has to keep the
    // promise, including the jammed ones where two rows are not enough.
    for (const seed of [0x51de51de, 0x0a11717, 0x0577ed1, 0x5eedc0de, 0x0b0ec12]) {
      let session = newSession(gameSeed(seed % 0x1000000));
      while (!session.state.over) {
        const state = session.state;
        let move = null;
        for (let slot = 0; slot < state.hand.length && !move; slot++) {
          const held = state.hand[slot];
          if (!held) continue;
          const anchor = legalAnchors(state.board, getPiece(held.pieceId))[0];
          if (anchor) move = { slot, row: anchor[0], col: anchor[1] };
        }
        if (!move) break;
        const applied = applyAction(session, move);
        if (!applied.ok) throw new Error(applied.reason);
        session = applied.session;
      }
      if (!session.state.over) continue;

      const revived = applyAction(session, { t: 'revive' });
      if (!revived.ok) throw new Error(`revive refused: ${revived.reason}`);

      const hand = revived.session.state.hand;
      expect(hand.filter(Boolean)).toHaveLength(3);
      const fit = hand.filter(
        (slot) => slot && hasAnyPlacement(revived.session.state.board, getPiece(slot.pieceId)),
      ).length;
      expect(fit).toBeGreaterThanOrEqual(REVIVE_MIN_PLAYABLE);
      expect(revived.session.state.over).toBe(false);
    }
  });

  it('clears the bottom rows and starts the game again', () => {
    const dead = playedOut();
    const filledBefore = dead.state.board.filter((cell) => cell !== 0).length;

    const revived = applyAction(dead, { t: 'revive' });
    if (!revived.ok) throw new Error(revived.reason);

    expect(revived.session.state.over).toBe(false);
    expect(revived.session.state.board.slice(-REVIVE_ROWS * 8).every((c) => c === 0)).toBe(true);
    expect(revived.session.state.board.filter((c) => c !== 0).length).toBeLessThan(filledBefore);
    // The score survives — a revive continues the game, it does not restart it.
    expect(revived.session.state.score).toBe(dead.state.score);
    expect(revived.session.revivesUsed).toBe(1);
  });

  it('keeps the promise even on boards where two rows are not enough', () => {
    // Deterministic pseudo-random fills, including nearly solid ones, so the
    // escalation past REVIVE_ROWS is actually exercised rather than hoped for.
    let rng = 12345;
    const nextRandom = () => {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return rng / 0x1_0000_0000;
    };

    for (let trial = 0; trial < 60; trial++) {
      const base = newGame(SEED);
      const board = Uint8Array.from(base.board);
      const density = 0.75 + (trial / 60) * 0.25;
      for (let i = 0; i < board.length; i++) board[i] = nextRandom() < density ? 1 : 0;

      const dead = {
        ...base,
        state: { ...base, board, over: true },
        checkpoints: [],
        undosUsed: 0,
        revivesUsed: 0,
      };

      const result = applyAction(dead, { t: 'revive' });
      if (!result.ok) throw new Error(`trial ${trial} refused: ${result.reason}`);

      const { state } = result.session;
      expect(state.hand.filter(Boolean)).toHaveLength(3);
      const fit = state.hand.filter(
        (slot) => slot && hasAnyPlacement(state.board, getPiece(slot.pieceId)),
      ).length;
      expect(fit).toBeGreaterThanOrEqual(REVIVE_MIN_PLAYABLE);
      expect(state.over).toBe(false);
    }
  });

  it('costs no gems, unlike the powers', () => {
    expect(gemCost([{ t: 'revive' }])).toBe(0);
    expect(gemCost([{ t: 'revive' }, { t: 'undo' }])).toBe(POWER_COSTS.undo);
  });

  it('leaves nothing to undo back into the game that ended', () => {
    const revived = applyAction(playedOut(), { t: 'revive' });
    if (!revived.ok) throw new Error(revived.reason);
    expect(canUndo(revived.session)).toBe(false);
  });

  it('runs out after three', () => {
    let session = playedOut();
    for (let i = 0; i < MAX_REVIVES; i++) {
      const revived = applyAction(session, { t: 'revive' });
      if (!revived.ok) throw new Error(`revive ${i + 1}: ${revived.reason}`);
      // Play it back into the ground for the next revive.
      session = { ...revived.session, state: { ...revived.session.state, over: true } };
    }
    expect(canRevive(session)).toBe(false);
    expect(applyAction(session, { t: 'revive' })).toEqual({
      ok: false,
      reason: 'no-revives-left',
    });
  });

  it('is part of the transcript, so the server can replay it', () => {
    const dead = playedOut();
    const revived = applyAction(dead, { t: 'revive' });
    if (!revived.ok) throw new Error(revived.reason);
    // Deterministic: the same actions reach the same board on the server.
    expect(applyAction(dead, { t: 'revive' })).toEqual(revived);
  });
});
