import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SIZE, getPiece, type Board, type HandSlot, type Move } from '@blokduo/engine';
import {
  anchorFromDrag,
  dragOrigin,
  grabOffsetForPointer,
  isTapGesture,
  previewAtAnchor,
  type Anchor,
  type DragState,
  type Geometry,
  type Preview,
} from './placementMath';

export type { DragState, Geometry, Preview } from './placementMath';

/**
 * Measure the board.
 *
 * Geometry is computed in JS because dragging converts pointer coordinates to
 * a board cell. Cells are drawn from the same stride, keeping input and visuals
 * aligned exactly.
 *
 * The element is tracked in state via a callback ref rather than read from a
 * ref object: duo only mounts the board once the room state arrives, and an
 * effect that reads `ref.current` on mount would find nothing and never run
 * again — leaving dragging with no coordinate space to aim in.
 */
export function useGeometry(): {
  geom: Geometry;
  boardRef: (el: HTMLDivElement | null) => void;
  measureNow: () => Geometry | null;
} {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [geom, setGeom] = useState<Geometry>({ stride: 0, cell: 0, gap: 0, rect: null });
  const elRef = useRef<HTMLElement | null>(null);

  const boardRef = useCallback((node: HTMLDivElement | null) => {
    elRef.current = node;
    setEl(node);
  }, []);

  const measureNow = useCallback((): Geometry | null => {
    const node = elRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const stride = rect.width / SIZE;
    const gap = Math.max(2, Math.round(stride * 0.08));
    const next = { stride, cell: stride - gap, gap, rect };
    setGeom((current) => {
      const unchanged =
        Math.abs(current.stride - stride) < 0.01 &&
        current.gap === gap &&
        current.rect !== null &&
        Math.abs(current.rect.left - rect.left) < 0.25 &&
        Math.abs(current.rect.top - rect.top) < 0.25 &&
        Math.abs(current.rect.width - rect.width) < 0.25;
      return unchanged ? current : next;
    });
    return next;
  }, []);

  useEffect(() => {
    if (!el) return;

    let measureFrame: number | null = null;

    const measure = () => {
      measureFrame = null;
      measureNow();
    };

    const scheduleMeasure = () => {
      if (measureFrame === null) measureFrame = window.requestAnimationFrame(measure);
    };

    const onVisibility = () => {
      if (!document.hidden) scheduleMeasure();
    };

    measure();
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(el);
    window.addEventListener('scroll', scheduleMeasure, { capture: true, passive: true });
    window.addEventListener('resize', scheduleMeasure);
    // A hidden tab reports a zero-sized viewport, so anything measured while
    // backgrounded is wrong. Phones background apps constantly, so re-measure
    // on the way back rather than trusting the resize to have fired.
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (measureFrame !== null) window.cancelAnimationFrame(measureFrame);
      ro.disconnect();
      window.removeEventListener('scroll', scheduleMeasure, true);
      window.removeEventListener('resize', scheduleMeasure);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [el, measureNow]);

  return { geom, boardRef, measureNow };
}

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
  /** Fixed-position element moved directly on animation frames. */
  dragPositionRef: (el: HTMLDivElement | null) => void;
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
  measureGeometry?: () => Geometry | null,
): PlacementApi {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragAnchor, setDragAnchor] = useState<Anchor | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [cursor, setCursorState] = useState<{ row: number; col: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragAnchorRef = useRef<Anchor | null>(null);
  const dragPositionElRef = useRef<HTMLDivElement | null>(null);
  const boardStateRef = useRef(board);
  const handRef = useRef(hand);
  const geomRef = useRef(geom);
  const commitRef = useRef(onCommit);
  const rejectRef = useRef(onReject);
  const moveFrameRef = useRef<number | null>(null);
  const suppressSelectRef = useRef<{ slot: number; until: number } | null>(null);

  boardStateRef.current = board;
  handRef.current = hand;
  geomRef.current = geom;
  commitRef.current = onCommit;
  rejectRef.current = onReject;

  const updateDragPosition = useCallback((current: DragState) => {
    const el = dragPositionElRef.current;
    const origin = dragOrigin(current, geomRef.current);
    if (!el || !origin) return;
    el.style.transform = `translate3d(${origin.left}px, ${origin.top}px, 0)`;
  }, []);

  const publishDragAnchor = useCallback((current: DragState): Anchor | null => {
    const next = anchorFromDrag(current, geomRef.current, dragAnchorRef.current);
    const previous = dragAnchorRef.current;
    if (next?.row === previous?.row && next?.col === previous?.col) return next;
    dragAnchorRef.current = next;
    setDragAnchor(next);
    return next;
  }, []);

  const dragPositionRef = useCallback(
    (el: HTMLDivElement | null) => {
      dragPositionElRef.current = el;
      const current = dragRef.current;
      if (el && current) updateDragPosition(current);
    },
    [updateDragPosition],
  );

  // Drop selection whenever the piece behind it disappears (placed, or refilled).
  useEffect(() => {
    if (selected !== null && !hand[selected]) {
      setSelected(null);
      setCursorState(null);
    }
  }, [hand, selected]);

  useEffect(() => {
    if (!enabled) {
      dragRef.current = null;
      dragAnchorRef.current = null;
      setDrag(null);
      setDragAnchor(null);
      setSelected(null);
      setCursorState(null);
    }
  }, [enabled]);

  // Keep the visual and snapped target aligned if the board is resized or
  // shifted while a pointer is held (orientation changes are the common case).
  useLayoutEffect(() => {
    const current = dragRef.current;
    if (!current) return;
    updateDragPosition(current);
    publishDragAnchor(current);
  }, [geom, publishDragAnchor, updateDragPosition]);

  const activeSlot = drag?.slot ?? selected;
  let activeAnchor = drag ? dragAnchor : null;
  if (!drag && selected !== null && cursor && hand[selected]) {
    const piece = getPiece(hand[selected].pieceId);
    activeAnchor = {
      row: cursor.row - Math.floor((piece.h - 1) / 2),
      col: cursor.col - Math.floor((piece.w - 1) / 2),
    };
  }
  const anchorRow = activeAnchor?.row ?? null;
  const anchorCol = activeAnchor?.col ?? null;

  // Pointer pixels change every frame, but the board only needs a new preview
  // when the implied cell changes. Keeping this object stable lets the memoized
  // board skip nearly every drag-frame render.
  const preview = useMemo<Preview | null>(() => {
    if (activeSlot === null || anchorRow === null || anchorCol === null) return null;
    return previewAtAnchor(board, hand, activeSlot, { row: anchorRow, col: anchorCol });
  }, [activeSlot, anchorRow, anchorCol, board, hand]);

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
      if (!enabled || event.isPrimary === false || dragRef.current) return;
      const measured = measureGeometry?.();
      if (measured) geomRef.current = measured;
      try {
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      } catch {
        // Capture is an optimisation, not a requirement — move and up are bound
        // to the window regardless. Throws if the pointer is already gone.
      }
      setSelected(null);
      setCursorState(null);
      const grab = grabOffsetForPointer(
        event.pointerType,
        event.clientX,
        event.clientY,
        trayPieceRect,
        trayStride,
      );
      const next: DragState = {
        slot,
        pieceId: held.pieceId,
        color: held.color,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        originX: event.clientX,
        originY: event.clientY,
        // Captured in cell units so the grab point survives the piece scaling up
        // from tray size to board size mid-drag.
        grabCellX: grab.x,
        grabCellY: grab.y,
        touch: event.pointerType === 'touch',
      };
      dragRef.current = next;
      const anchor = anchorFromDrag(next, geomRef.current);
      dragAnchorRef.current = anchor;
      setDragAnchor(anchor);
      setDrag(next);
    },
    [enabled, measureGeometry],
  );

  // Pointer listeners stay mounted for the lifetime of the surface. Previously
  // this effect depended on the whole drag object, so every pointermove removed
  // and re-added all three global listeners. Moves are also coalesced to one
  // React update per animation frame for 120Hz/240Hz touchscreens.
  useEffect(() => {
    const cancelMoveFrame = () => {
      if (moveFrameRef.current !== null) {
        window.cancelAnimationFrame(moveFrameRef.current);
        moveFrameRef.current = null;
      }
    };

    const clearDrag = () => {
      cancelMoveFrame();
      dragRef.current = null;
      dragAnchorRef.current = null;
      setDrag(null);
      setDragAnchor(null);
    };

    const onMove = (e: PointerEvent) => {
      const current = dragRef.current;
      if (!current || e.pointerId !== current.pointerId) return;
      e.preventDefault();
      const coalesced = e.getCoalescedEvents?.();
      const latest = coalesced?.length ? coalesced[coalesced.length - 1] : e;
      dragRef.current = { ...current, x: latest.clientX, y: latest.clientY };
      if (moveFrameRef.current !== null) return;
      moveFrameRef.current = window.requestAnimationFrame(() => {
        moveFrameRef.current = null;
        const active = dragRef.current;
        if (!active) return;
        updateDragPosition(active);
        publishDragAnchor(active);
      });
    };

    const onUp = (e: PointerEvent) => {
      const active = dragRef.current;
      if (!active || e.pointerId !== active.pointerId) return;
      const finalDrag = { ...active, x: e.clientX, y: e.clientY };
      // A tap is the click-to-select path, not a failed drag. Let the tray's
      // click handler run without playing a rejection sound or committing.
      if (isTapGesture(finalDrag, e.clientX, e.clientY)) {
        clearDrag();
        return;
      }

      e.preventDefault();
      const anchor = anchorFromDrag(finalDrag, geomRef.current, dragAnchorRef.current);
      const p = anchor
        ? previewAtAnchor(boardStateRef.current, handRef.current, finalDrag.slot, anchor)
        : null;
      clearDrag();
      // Browsers can dispatch a click after a drag. Suppress just that click so
      // the newly refilled piece in this slot is not accidentally selected.
      suppressSelectRef.current = { slot: finalDrag.slot, until: performance.now() + 400 };
      if (
        p?.valid &&
        commitRef.current({ slot: finalDrag.slot, row: p.row, col: p.col })
      ) {
        return;
      }
      rejectRef.current();
    };

    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== dragRef.current?.pointerId) return;
      clearDrag();
    };

    const onLostCapture = (e: Event) => {
      const pointerId = (e as PointerEvent).pointerId;
      if (pointerId !== dragRef.current?.pointerId) return;
      clearDrag();
    };

    const onBlur = () => {
      if (dragRef.current) clearDrag();
    };

    const onVisibility = () => {
      if (document.hidden && dragRef.current) clearDrag();
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onBlur);
    document.addEventListener('lostpointercapture', onLostCapture, true);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelMoveFrame();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('lostpointercapture', onLostCapture, true);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [publishDragAnchor, updateDragPosition]);

  const toggleSelect = useCallback(
    (slot: number) => {
      if (!enabled || !hand[slot]) return;
      const suppressed = suppressSelectRef.current;
      suppressSelectRef.current = null;
      if (suppressed?.slot === slot && performance.now() <= suppressed.until) return;
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
    dragPositionRef,
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
