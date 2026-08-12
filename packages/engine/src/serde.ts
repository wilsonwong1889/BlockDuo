import { CELLS } from './board.js';
import type { Board, GameState, HandSlot } from './types.js';

/**
 * Wire format. Uint8Array does not survive JSON, and the multiplayer protocol
 * sends full snapshots on join and on rollback, so the board is encoded as a
 * 64-character string of digits 0-7 — compact, human-readable in logs, and
 * cheap to parse.
 */

export function encodeBoard(board: Board): string {
  let out = '';
  for (let i = 0; i < CELLS; i++) out += String(board[i]);
  return out;
}

export function decodeBoard(s: string): Board {
  if (s.length !== CELLS) throw new Error(`Board string must be ${CELLS} chars, got ${s.length}`);
  const board = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    const v = s.charCodeAt(i) - 48;
    if (v < 0 || v > 7) throw new Error(`Bad cell value at ${i}: ${s[i]}`);
    board[i] = v;
  }
  return board;
}

export interface WireGameState extends Omit<GameState, 'board'> {
  board: string;
}

export function encodeState(state: GameState): WireGameState {
  return { ...state, board: encodeBoard(state.board) };
}

export function decodeState(wire: WireGameState): GameState {
  return {
    ...wire,
    board: decodeBoard(wire.board),
    hand: wire.hand.map((s) => (s ? ({ ...s } as HandSlot) : null)),
  };
}
