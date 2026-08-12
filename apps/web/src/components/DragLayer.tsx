import { getPiece } from '@blokduo/engine';
import { PieceShape } from './PieceShape';
import type { DragState, Geometry } from '../game/usePlacement';

interface Props {
  drag: DragState | null;
  geom: Geometry;
  valid: boolean;
}

/** Matches TOUCH_LIFT_CELLS in usePlacement — the piece floats above the finger. */
const TOUCH_LIFT_CELLS = 1.6;

/**
 * The piece being dragged, drawn at full board scale in a fixed-position layer
 * so it can travel outside the board without being clipped.
 */
export function DragLayer({ drag, geom, valid }: Props) {
  if (!drag || geom.stride === 0) return null;

  const piece = getPiece(drag.pieceId);
  const lift = drag.touch ? TOUCH_LIFT_CELLS * geom.stride : 0;
  const left = drag.x - drag.grabCellX * geom.stride;
  const top = drag.y - drag.grabCellY * geom.stride - lift;

  return (
    <div className="drag-layer">
      <PieceShape
        className={`piece dragging${valid ? '' : ' invalid'}`}
        pieceId={piece.id}
        color={drag.color}
        stride={geom.stride}
        gap={geom.gap}
        style={{ position: 'fixed', left, top, pointerEvents: 'none' }}
      />
    </div>
  );
}
