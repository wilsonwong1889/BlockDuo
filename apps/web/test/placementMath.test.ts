import { describe, expect, it } from 'vitest';
import { DUO_TURN_MS, boardFromString, emptyBoard, type HandSlot } from '@blokduo/engine';
import {
  DRAG_THRESHOLD_PX,
  SNAP_HYSTERESIS_CELLS,
  TOUCH_LIFT_CELLS,
  anchorFromDrag,
  dragOrigin,
  grabOffsetForPointer,
  isTapGesture,
  previewAtAnchor,
  type DragState,
  type Geometry,
} from '../src/game/placementMath';
import { turnTime } from '../src/components/TurnTimer';

const rect = { left: 100, top: 200, width: 400 } as DOMRect;
const geom: Geometry = { stride: 50, cell: 46, gap: 4, rect };
const pieceRect = {
  left: 40,
  top: 500,
  right: 115,
  bottom: 525,
  width: 75,
  height: 25,
} as DOMRect;

function drag(overrides: Partial<DragState> = {}): DragState {
  return {
    slot: 0,
    pieceId: '1x1',
    color: 1,
    pointerId: 1,
    x: 225,
    y: 325,
    originX: 225,
    originY: 325,
    grabCellX: 0.5,
    grabCellY: 0.5,
    touch: false,
    ...overrides,
  };
}

describe('placement coordinates', () => {
  it('maps the grabbed point to the same board anchor that is drawn', () => {
    expect(anchorFromDrag(drag(), geom)).toEqual({ row: 2, col: 2 });
  });

  it('accounts for the touch lift above the finger', () => {
    expect(
      anchorFromDrag(
        drag({ y: 325 + TOUCH_LIFT_CELLS * geom.stride, touch: true }),
        geom,
      ),
    ).toEqual({ row: 2, col: 2 });
  });

  it('keeps the lift within the range that is worth having', () => {
    // Below about a cell and a half the piece is back under the thumb; much
    // above two and it stops feeling attached to the finger. The exact value
    // inside that range is a feel decision, not something to pin down here.
    expect(TOUCH_LIFT_CELLS).toBeGreaterThanOrEqual(1.5);
    expect(TOUCH_LIFT_CELLS).toBeLessThanOrEqual(3);
  });

  it('gives a precise pointer no lift, so the piece stays under the cursor', () => {
    const gesture = drag({ y: 325, touch: false });
    expect(dragOrigin(gesture, geom)?.top).toBe(
      dragOrigin({ ...gesture, touch: true }, geom).top + TOUCH_LIFT_CELLS * geom.stride,
    );
  });

  it('uses one origin for both the visual position and board target', () => {
    const gesture = drag({ x: 287, y: 391, grabCellX: 1.25, grabCellY: 0.25 });
    const origin = dragOrigin(gesture, geom);

    expect(origin).toEqual({ left: 224.5, top: 378.5 });
    expect(anchorFromDrag(gesture, geom)).toEqual({ row: 4, col: 2 });
  });

  it('centres touch pickups so small pieces stay under the finger', () => {
    expect(grabOffsetForPointer('touch', 42, 502, pieceRect, 25)).toEqual({ x: 1.5, y: 0.5 });
  });

  it('centres forgiving pickups that begin in tray whitespace', () => {
    expect(grabOffsetForPointer('mouse', 20, 510, pieceRect, 25)).toEqual({ x: 1.5, y: 0.5 });
  });

  it('keeps an accurate inside grab for a mouse or pen', () => {
    expect(grabOffsetForPointer('mouse', 90, 512.5, pieceRect, 25)).toEqual({ x: 2, y: 0.5 });
    expect(grabOffsetForPointer('pen', 65, 505, pieceRect, 25)).toEqual({ x: 1, y: 0.2 });
  });

  it('holds a snapped cell through boundary jitter, then advances decisively', () => {
    const previous = { row: 2, col: 2 };
    const withinHysteresis = (0.5 + SNAP_HYSTERESIS_CELLS - 0.01) * geom.stride;
    const pastHysteresis = (0.5 + SNAP_HYSTERESIS_CELLS + 0.01) * geom.stride;
    const base = drag({
      x: geom.rect!.left + 2 * geom.stride,
      y: geom.rect!.top + 2 * geom.stride,
      grabCellX: 0,
      grabCellY: 0,
    });

    expect(anchorFromDrag({ ...base, x: base.x + withinHysteresis }, geom, previous)).toEqual(
      previous,
    );
    expect(anchorFromDrag({ ...base, x: base.x + pastHysteresis }, geom, previous)).toEqual({
      row: 2,
      col: 3,
    });
  });

  it('returns no anchor before the board has been measured', () => {
    expect(anchorFromDrag(drag(), { ...geom, rect: null })).toBeNull();
  });

  it('distinguishes a tap wobble from an intentional drag', () => {
    const gesture = drag({ originX: 20, originY: 20 });
    expect(isTapGesture(gesture, 20 + DRAG_THRESHOLD_PX - 0.1, 20)).toBe(true);
    expect(isTapGesture(gesture, 20 + DRAG_THRESHOLD_PX, 20)).toBe(false);
  });
});

describe('placement preview', () => {
  const single: HandSlot = { pieceId: '1x1', color: 2 };

  it('reports the exact cells for a legal placement', () => {
    expect(previewAtAnchor(emptyBoard(), [single, null, null], 0, { row: 3, col: 4 })).toMatchObject({
      row: 3,
      col: 4,
      valid: true,
      cells: [28],
      clearRows: [],
      clearCols: [],
    });
  });

  it('predicts a line clear without mutating the board', () => {
    const board = boardFromString(`
      #######.
      ........
      ........
      ........
      ........
      ........
      ........
      ........
    `);
    const before = [...board];
    const preview = previewAtAnchor(board, [single, null, null], 0, { row: 0, col: 7 });

    expect(preview).toMatchObject({ valid: true, clearRows: [0], clearCols: [] });
    expect([...board]).toEqual(before);
  });

  it('clips an invalid out-of-bounds preview to visible cells', () => {
    const bar: HandSlot = { pieceId: '1x3', color: 3 };
    expect(previewAtAnchor(emptyBoard(), [bar, null, null], 0, { row: 0, col: 7 })).toMatchObject({
      valid: false,
      cells: [7],
    });
  });
});

describe('duo turn clock', () => {
  it('clamps cleanly at both ends of the turn', () => {
    expect(turnTime(50_000, 5_000)).toEqual({
      remainingMs: 45_000,
      seconds: 45,
      fraction: 1,
    });
    expect(turnTime(50_000, 50_001)).toEqual({
      remainingMs: 0,
      seconds: 0,
      fraction: 0,
    });
  });

  it('measures the bar against this room’s turn, not a fixed one', () => {
    // Half a Ranked turn gone should look half gone. Measured against the old
    // fixed 45s the bar would sit at 5% and never visibly move.
    expect(turnTime(2_500, 0, DUO_TURN_MS.ranked).fraction).toBeCloseTo(0.5);
    expect(turnTime(30_000, 0, DUO_TURN_MS.classic).fraction).toBeCloseTo(0.5);
  });

  it('never divides by a turn length of zero', () => {
    expect(turnTime(5_000, 0, 0).fraction).toBe(0);
  });
});
