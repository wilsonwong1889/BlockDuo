import {
  SIZE,
  findClears,
  fits,
  getPiece,
  idx,
  place,
  type Board,
  type HandSlot,
} from '@blokduo/engine';

export interface Geometry {
  /** Distance from one cell's left edge to the next, including the gap. */
  stride: number;
  /** Drawn size of a cell. */
  cell: number;
  gap: number;
  rect: DOMRect | null;
}

export interface DragState {
  slot: number;
  pieceId: string;
  color: number;
  pointerId: number;
  /** Current pointer position in client coordinates. */
  x: number;
  y: number;
  /** Initial pointer position, used to distinguish a tap from a drag. */
  originX: number;
  originY: number;
  /** Where inside the piece it was grabbed, in cell units. */
  grabCellX: number;
  grabCellY: number;
  touch: boolean;
}

export interface Preview {
  row: number;
  col: number;
  valid: boolean;
  /** Board indices the piece would occupy. */
  cells: number[];
  /** Rows and columns that would clear if this placement were made. */
  clearRows: number[];
  clearCols: number[];
}

export interface Anchor {
  row: number;
  col: number;
}

/** Keep a touch-dragged piece above the player's thumb. */
export const TOUCH_LIFT_CELLS = 1.6;

/** Small pointer wobble is still a tap; crossing this starts drag semantics. */
export const DRAG_THRESHOLD_PX = 8;

export function isTapGesture(drag: DragState, x: number, y: number): boolean {
  return Math.hypot(x - drag.originX, y - drag.originY) < DRAG_THRESHOLD_PX;
}

/** Convert the live pointer position into the piece's top-left board anchor. */
export function anchorFromDrag(drag: DragState, geom: Geometry): Anchor | null {
  if (!geom.rect || geom.stride === 0) return null;
  const lift = drag.touch ? TOUCH_LIFT_CELLS * geom.stride : 0;
  const originX = drag.x - drag.grabCellX * geom.stride;
  const originY = drag.y - drag.grabCellY * geom.stride - lift;
  return {
    row: Math.round((originY - geom.rect.top) / geom.stride),
    col: Math.round((originX - geom.rect.left) / geom.stride),
  };
}

/** Build the stable, cell-level preview used by both dragging and keyboard placement. */
export function previewAtAnchor(
  board: Board,
  hand: ReadonlyArray<HandSlot | null>,
  slot: number,
  anchor: Anchor,
): Preview | null {
  const held = hand[slot];
  if (!held) return null;

  const piece = getPiece(held.pieceId);
  const { row, col } = anchor;
  const valid = fits(board, piece, row, col);
  const cells = piece.cells
    .map(([dr, dc]) => ({ r: row + dr, c: col + dc }))
    .filter(({ r, c }) => r >= 0 && c >= 0 && r < SIZE && c < SIZE)
    .map(({ r, c }) => idx(r, c));

  if (!valid) return { row, col, valid, cells, clearRows: [], clearCols: [] };

  const clears = findClears(place(board, piece, row, col, held.color));
  return {
    row,
    col,
    valid,
    cells,
    clearRows: clears.rows,
    clearCols: clears.cols,
  };
}
