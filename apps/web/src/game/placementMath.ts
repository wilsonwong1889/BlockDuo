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

export interface DragOrigin {
  left: number;
  top: number;
}

export interface GrabOffset {
  x: number;
  y: number;
}

/** Keep a touch-dragged piece above the player's thumb. */
export const TOUCH_LIFT_CELLS = 1.6;

/** Small pointer wobble is still a tap; crossing this starts drag semantics. */
export const DRAG_THRESHOLD_PX = 8;

/** Prevent tiny finger movements around a cell boundary from flickering targets. */
export const SNAP_HYSTERESIS_CELLS = 0.12;

export function isTapGesture(drag: DragState, x: number, y: number): boolean {
  return Math.hypot(x - drag.originX, y - drag.originY) < DRAG_THRESHOLD_PX;
}

/**
 * Choose a stable pickup point in cell units.
 *
 * Tray slots deliberately have generous hit areas. A pointer can therefore
 * begin outside the visible piece; treating that whitespace as a real offset
 * makes small pieces jump several cells away when they grow to board scale.
 * Touch always uses the visual centre, while precise pointers keep an inside
 * grab and fall back to the centre for forgiving slot-edge pickups.
 */
export function grabOffsetForPointer(
  pointerType: string,
  x: number,
  y: number,
  pieceRect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>,
  stride: number,
): GrabOffset {
  if (stride <= 0) return { x: 0, y: 0 };

  const centre = {
    x: pieceRect.width / stride / 2,
    y: pieceRect.height / stride / 2,
  };
  const inside =
    x >= pieceRect.left &&
    x <= pieceRect.right &&
    y >= pieceRect.top &&
    y <= pieceRect.bottom;

  if (pointerType === 'touch' || !inside) return centre;
  return {
    x: Math.min(pieceRect.width, Math.max(0, x - pieceRect.left)) / stride,
    y: Math.min(pieceRect.height, Math.max(0, y - pieceRect.top)) / stride,
  };
}

/** The exact visual top-left used by the compositor-driven drag layer. */
export function dragOrigin(drag: DragState, geom: Geometry): DragOrigin | null {
  if (geom.stride === 0) return null;
  const lift = drag.touch ? TOUCH_LIFT_CELLS * geom.stride : 0;
  return {
    left: drag.x - drag.grabCellX * geom.stride,
    top: drag.y - drag.grabCellY * geom.stride - lift,
  };
}

function snapCoordinate(value: number, previous?: number): number {
  if (
    previous !== undefined &&
    Math.abs(value - previous) < 0.5 + SNAP_HYSTERESIS_CELLS
  ) {
    return previous;
  }
  return Math.round(value);
}

/** Convert the live pointer position into the piece's top-left board anchor. */
export function anchorFromDrag(
  drag: DragState,
  geom: Geometry,
  previous?: Anchor | null,
): Anchor | null {
  if (!geom.rect) return null;
  const origin = dragOrigin(drag, geom);
  if (!origin) return null;
  return {
    row: snapCoordinate((origin.top - geom.rect.top) / geom.stride, previous?.row),
    col: snapCoordinate((origin.left - geom.rect.left) / geom.stride, previous?.col),
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
