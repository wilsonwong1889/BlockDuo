import { useRef } from 'react';
import { getPiece, hasAnyPlacement, type Board, type HandSlot } from '@blokduo/engine';
import { PieceShape } from './PieceShape';

interface Props {
  hand: (HandSlot | null)[];
  board: Board;
  /** Board cell stride, so tray pieces stay proportional to the board. */
  boardStride: number;
  gap: number;
  selected: number | null;
  draggingSlot: number | null;
  disabled?: boolean;
  onStart: (event: React.PointerEvent, slot: number, held: HandSlot, rect: DOMRect, stride: number) => void;
  onSelect: (slot: number) => void;
}

/**
 * Tray pieces render at half the board's cell size: three of them, the widest
 * five cells across, have to share the board's width. The same ratio is used to
 * scale the piece up when it is picked up, so the shape grows into the board
 * rather than jumping to a new size.
 */
export const TRAY_SCALE = 0.5;

export function Tray({
  hand,
  board,
  boardStride,
  gap,
  selected,
  draggingSlot,
  disabled,
  onStart,
  onSelect,
}: Props) {
  const stride = boardStride * TRAY_SCALE;
  const trayGap = Math.max(1, gap * TRAY_SCALE);
  const refs = useRef<Array<HTMLDivElement | null>>([]);

  return (
    <div className="tray" role="group" aria-label="Pieces to place">
      {hand.map((held, slot) => {
        const dead = held ? !hasAnyPlacement(board, getPiece(held.pieceId)) : false;
        const isDragging = draggingSlot === slot;

        return (
          <div
            key={slot}
            className={[
              'tray-slot',
              held ? 'occupied' : 'empty',
              selected === slot ? 'selected' : '',
              isDragging ? 'lifted' : '',
              dead ? 'dead' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            ref={(el) => {
              refs.current[slot] = el;
            }}
            onPointerDown={(e) => {
              if (!held || disabled || e.button > 0) return;
              const el = refs.current[slot]?.querySelector('.piece') as HTMLElement | null;
              if (!el) return;
              e.preventDefault();
              onStart(e, slot, held, el.getBoundingClientRect(), stride);
            }}
            onClick={() => {
              if (held && !disabled) onSelect(slot);
            }}
            role="button"
            tabIndex={held && !disabled ? 0 : -1}
            aria-disabled={!held || disabled}
            aria-pressed={selected === slot}
            aria-label={held ? `Piece ${held.pieceId}${dead ? ', no space for it' : ''}` : 'Empty slot'}
            onKeyDown={(e) => {
              if (held && !disabled && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onSelect(slot);
              }
            }}
          >
            {held && (
              <PieceShape
                className="piece"
                pieceId={held.pieceId}
                color={held.color}
                stride={stride}
                gap={trayGap}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
