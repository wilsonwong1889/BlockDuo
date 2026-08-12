import { getPiece, SIZE, type Board, type HandSlot, type Move } from '@blokduo/engine';

/**
 * Visual effects shared by classic and duo.
 *
 * Both modes animate a clear the same way — as an overlay of the cells as they
 * were, because by the time the UI hears about a clear the cells are already
 * gone from the board. Classic learns about it from engine events, duo from the
 * server's `applied` message, so the construction lives here rather than being
 * written twice and drifting.
 */

export interface ClearFx {
  id: number;
  cells: Array<{ index: number; color: number }>;
  lines: number;
}

export interface FloatFx {
  id: number;
  row: number;
  col: number;
  text: string;
  kind: 'score' | 'combo' | 'perfect';
}

let nextId = 0;
export const fxId = () => ++nextId;

/**
 * A cleared cell might be one the player just placed, in which case it is not on
 * the pre-move board. Recover its colour from the piece that was played.
 */
export function colorOfCell(
  boardBefore: Board,
  played: HandSlot | null,
  move: Move,
  index: number,
): number {
  const existing = boardBefore[index];
  if (existing) return existing;
  if (!played) return 1;

  const piece = getPiece(played.pieceId);
  const row = Math.floor(index / SIZE);
  const col = index % SIZE;
  const covered = piece.cells.some(([dr, dc]) => move.row + dr === row && move.col + dc === col);
  return covered ? played.color : 1;
}

export function buildClearFx(
  boardBefore: Board,
  played: HandSlot | null,
  move: Move,
  cellIndices: number[],
  lines: number,
): ClearFx {
  return {
    id: fxId(),
    lines,
    cells: cellIndices.map((index) => ({
      index,
      color: colorOfCell(boardBefore, played, move, index),
    })),
  };
}
