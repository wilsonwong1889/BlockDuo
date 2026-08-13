import { memo } from 'react';
import { PieceShape } from './PieceShape';
import type { DragState, Geometry } from '../game/placementMath';

interface Props {
  drag: DragState | null;
  geom: Geometry;
  valid: boolean;
  positionRef: (el: HTMLDivElement | null) => void;
}

/**
 * The piece being dragged, drawn at full board scale in a fixed-position layer
 * so it can travel outside the board without being clipped.
 */
function DragLayerView({ drag, geom, valid, positionRef }: Props) {
  if (!drag || geom.stride === 0) return null;

  return (
    <div className="drag-layer">
      <div ref={positionRef} className="drag-piece-position">
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

/** Pixel-level movement is applied to the position element without React renders. */
export const DragLayer = memo(DragLayerView);
