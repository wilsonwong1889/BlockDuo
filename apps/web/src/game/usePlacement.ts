import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SIZE,
  fits,
  findClears,
  getPiece,
  idx,
  place,
  type Board,
  type HandSlot,
  type Move,
} from '@blokduo/engine';

/**
 * Board geometry is computed in JS rather than left to CSS grid.
 *
 * Dragging needs to convert pointer coordinates into a board cell every frame,
 * and doing that against a measured stride is exact. Cells are positioned
 * absolutely from the same numbers, so what the maths thinks is at (row, col) is
 * always precisely what is drawn there.
 */
export interface Geometry {
  /** Distance from one cell's left edge to the next, including the gap. */
  stride: number;
  /** Drawn size of a cell. */
  cell: number;
  gap: number;
  rect: DOMRect | null;
}

export function useGeometry(ref: React.RefObject<HTMLElement>): Geometry {
  const [geom, setGeom] = useState<Geometry>({ stride: 0, cell: 0, gap: 0, rect: null });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const stride = rect.width / SIZE;
      const gap = Math.max(2, Math.round(stride * 0.08));
      setGeom({ stride, cell: stride - gap, gap, rect });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [ref]);

  return geom;
}

export interface DragState {
  slot: number;
  pieceId: string;
  color: number;
  pointerId: number;
  /** Current pointer position in client coordinates. */
  x: number;
  y: number;
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

/**
 * On touch, the piece floats above the finger by this many cells. Without it the
 * thumb covers exactly the cells you are trying to aim at, which is the single
 * biggest difference between a block puzzle that feels good on a phone and one
 * that does not.
 */
const TOUCH_LIFT_CELLS = 1.6;

export interface PlacementApi {
  drag: DragState | null;
  selected: number | null;
  preview: Preview | null;
  /** Begin a drag from a tray piece. */
  startDrag: (
    event: React.PointerEvent,
    slot: number,
    hand: HandSlot,
    trayPieceRect: DOMRect,
    trayStride: number,
  ) => void;
  /** Tap-to-select, for desktop clicking and for keyboard/assistive use. */
  toggleSelect: (slot: number) => void;
  clearSelection: () => void;
  /** Hover or keyboard cursor over a board cell while a piece is selected. */
  setCursor: (row: number, col: number) => void;
  placeAtCursor: () => void;
  moveCursor: (dRow: number, dCol: number) => void;
}

export function usePlacement(
  board: Board,
  hand: (HandSlot | null)[],
  geom: Geometry,
  onCommit: (move: Move) => boolean,
  onReject: () => void,
  enabled = true,
): PlacementApi {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [cursor, setCursorState] = useState<{ row: number; col: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  // Drop selection whenever the piece behind it disappears (placed, or refilled).
  useEffect(() => {
    if (selected !== null && !hand[selected]) {
      setSelected(null);
      setCursorState(null);
    }
  }, [hand, selected]);

  useEffect(() => {
    if (!enabled) {
      setDrag(null);
      setSelected(null);
      setCursorState(null);
    }
  }, [enabled]);

  /** Anchor implied by the current drag, in board coordinates. */
  const dragAnchor = useMemo(() => {
    if (!drag || !geom.rect || geom.stride === 0) return null;
    const lift = drag.touch ? TOUCH_LIFT_CELLS * geom.stride : 0;
    const originX = drag.x - drag.grabCellX * geom.stride;
    const originY = drag.y - drag.grabCellY * geom.stride - lift;
    return {
      row: Math.round((originY - geom.rect.top) / geom.stride),
      col: Math.round((originX - geom.rect.left) / geom.stride),
    };
  }, [drag, geom]);

  const preview = useMemo<Preview | null>(() => {
    const slot = drag ? drag.slot : selected;
    if (slot === null) return null;
    const held = hand[slot];
    if (!held) return null;

    const piece = getPiece(held.pieceId);
    let anchor: { row: number; col: number } | null = null;

    if (drag) {
      anchor = dragAnchor;
    } else if (cursor) {
      // Tap and keyboard aim from the middle of the piece, which is where people
      // expect the shape to land relative to the cell they picked.
      anchor = {
        row: cursor.row - Math.floor((piece.h - 1) / 2),
        col: cursor.col - Math.floor((piece.w - 1) / 2),
      };
    }
    if (!anchor) return null;

    const { row, col } = anchor;
    const valid = fits(board, piece, row, col);
    const cells = piece.cells
      .map(([dr, dc]) => ({ r: row + dr, c: col + dc }))
      .filter(({ r, c }) => r >= 0 && c >= 0 && r < SIZE && c < SIZE)
      .map(({ r, c }) => idx(r, c));

    let clearRows: number[] = [];
    let clearCols: number[] = [];
    if (valid) {
      const after = place(board, piece, row, col, held.color);
      const clears = findClears(after);
      clearRows = clears.rows;
      clearCols = clears.cols;
    }

    return { row, col, valid, cells, clearRows, clearCols };
  }, [drag, dragAnchor, selected, cursor, hand, board]);

  const previewRef = useRef<Preview | null>(null);
  previewRef.current = preview;

  const startDrag = useCallback(
    (
      event: React.PointerEvent,
      slot: number,
      held: HandSlot,
      trayPieceRect: DOMRect,
      trayStride: number,
    ) => {
      if (!enabled) return;
      try {
        (event.target as Element).setPointerCapture?.(event.pointerId);
      } catch {
        // Capture is an optimisation, not a requirement — move and up are bound
        // to the window regardless. Throws if the pointer is already gone.
      }
      setSelected(null);
      setCursorState(null);
      setDrag({
        slot,
        pieceId: held.pieceId,
        color: held.color,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        // Captured in cell units so the grab point survives the piece scaling up
        // from tray size to board size mid-drag.
        grabCellX: trayStride > 0 ? (event.clientX - trayPieceRect.left) / trayStride : 0,
        grabCellY: trayStride > 0 ? (event.clientY - trayPieceRect.top) / trayStride : 0,
        touch: event.pointerType !== 'mouse',
      });
    },
    [enabled],
  );

  // Pointer move/up are bound to the window, not the piece: a fast drag can
  // outrun the element under the cursor, and releasing outside the board must
  // still end the drag.
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      e.preventDefault();
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      const p = previewRef.current;
      const current = dragRef.current;
      setDrag(null);
      if (!current) return;
      if (p?.valid) {
        onCommit({ slot: current.slot, row: p.row, col: p.col });
      } else {
        onReject();
      }
    };

    const onCancel = () => setDrag(null);

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [drag, onCommit, onReject]);

  const toggleSelect = useCallback(
    (slot: number) => {
      if (!enabled || !hand[slot]) return;
      setSelected((s) => (s === slot ? null : slot));
      setCursorState((c) => c ?? { row: 3, col: 3 });
    },
    [enabled, hand],
  );

  const clearSelection = useCallback(() => {
    setSelected(null);
    setCursorState(null);
  }, []);

  const setCursor = useCallback((row: number, col: number) => {
    setCursorState({ row, col });
  }, []);

  const moveCursor = useCallback((dRow: number, dCol: number) => {
    setCursorState((c) => {
      const base = c ?? { row: 3, col: 3 };
      return {
        row: Math.min(SIZE - 1, Math.max(0, base.row + dRow)),
        col: Math.min(SIZE - 1, Math.max(0, base.col + dCol)),
      };
    });
  }, []);

  const placeAtCursor = useCallback(() => {
    const p = previewRef.current;
    if (selected === null || !p) return;
    if (p.valid) {
      if (onCommit({ slot: selected, row: p.row, col: p.col })) {
        setSelected(null);
        setCursorState(null);
      }
    } else {
      onReject();
    }
  }, [selected, onCommit, onReject]);

  return {
    drag,
    selected,
    preview,
    startDrag,
    toggleSelect,
    clearSelection,
    setCursor,
    placeAtCursor,
    moveCursor,
  };
}
