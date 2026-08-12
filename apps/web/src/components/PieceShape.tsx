import { getPiece } from '@blokduo/engine';
import { colorVars } from '../theme';

interface Props {
  pieceId: string;
  color: number;
  /** Distance between cell origins, including the gap. */
  stride: number;
  gap: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * A piece drawn free-standing, used both in the tray and as the thing that
 * follows your finger. Both call sites render the same component at different
 * strides, so a piece looks identical as it scales up out of the tray.
 */
export function PieceShape({ pieceId, color, stride, gap, className, style }: Props) {
  const piece = getPiece(pieceId);
  const cell = Math.max(stride - gap, 1);

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: piece.w * stride - gap,
        height: piece.h * stride - gap,
        ...colorVars(color),
        ...style,
      }}
      aria-hidden
    >
      {piece.cells.map(([r, c]) => (
        <div
          key={`${r}-${c}`}
          className="block"
          style={{ left: c * stride, top: r * stride, width: cell, height: cell }}
        />
      ))}
    </div>
  );
}
