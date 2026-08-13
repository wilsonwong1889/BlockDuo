import { PieceShape } from './PieceShape';
import { TOUCH_LIFT_CELLS, type DragState, type Geometry } from '../game/placementMath';

interface Props {
  drag: DragState | null;
  geom: Geometry;
  valid: boolean;
}

/**
 * The piece being dragged, drawn at full board scale in a fixed-position layer
 * so it can travel outside the board without being clipped.
 */
export function DragLayer({ drag, geom, valid }: Props) {
  if (!drag || geom.stride === 0) return null;

  const lift = drag.touch ? TOUCH_LIFT_CELLS * geom.stride : 0;
  const left = drag.x - drag.grabCellX * geom.stride;
  const top = drag.y - drag.grabCellY * geom.stride - lift;

  return (
    <div className="drag-layer">
      <div
        className="drag-piece-position"
        style={{ transform: `translate3d(${left}px, ${top}px, 0)` }}
      >
        <PieceShape
          className={`piece dragging${valid ? '' : ' invalid'}`}
          pieceId={drag.pieceId}
          color={drag.color}
          stride={geom.stride}
          gap={geom.gap}
        />
      </div>
    </div>
  );
}
