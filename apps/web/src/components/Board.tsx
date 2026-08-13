import { forwardRef, memo } from 'react';
import { CELLS, SIZE } from '@blokduo/engine';
import type { Board as BoardData } from '@blokduo/engine';
import { colorVars } from '../theme';
import type { Geometry, Preview } from '../game/usePlacement';
import type { ClearFx, FloatFx } from '../game/useClassicGame';

interface Props {
  board: BoardData;
  geom: Geometry;
  preview: Preview | null;
  clearFx: ClearFx[];
  floats: FloatFx[];
  shake: number;
  onCellEnter?: (row: number, col: number) => void;
  onCellClick?: (row: number, col: number) => void;
  dimmed?: boolean;
  dragging?: boolean;
}

interface BoardCellsProps {
  board: BoardData;
  geom: Geometry;
  preview: Preview | null;
  onCellEnter?: (row: number, col: number) => void;
  onCellClick?: (row: number, col: number) => void;
}

/**
 * The 64 stable board cells are isolated from short-lived celebration state.
 * Removing a clear ring, score float, or shake no longer rebuilds this grid.
 */
const BoardCells = memo(function BoardCells({
  board,
  geom,
  preview,
  onCellEnter,
  onCellClick,
}: BoardCellsProps) {
  const { stride, cell } = geom;
  const previewSet = new Set(preview?.cells ?? []);
  const clearRowSet = new Set(preview?.clearRows ?? []);
  const clearColSet = new Set(preview?.clearCols ?? []);

  return Array.from({ length: CELLS }, (_, i) => {
    const row = Math.floor(i / SIZE);
    const col = i % SIZE;
    const value = board[i];
    const inPreview = previewSet.has(i);
    const willClear = preview?.valid && (clearRowSet.has(row) || clearColSet.has(col));
    const classes = ['cell'];
    if (value) classes.push('filled');
    if (inPreview) classes.push(preview?.valid ? 'preview-ok' : 'preview-bad');
    if (willClear) classes.push('will-clear');

    return (
      <div
        key={i}
        className={classes.join(' ')}
        style={{
          left: col * stride,
          top: row * stride,
          width: cell,
          height: cell,
          ...(value ? colorVars(value) : undefined),
        }}
        onPointerEnter={onCellEnter ? () => onCellEnter(row, col) : undefined}
        onClick={onCellClick ? () => onCellClick(row, col) : undefined}
        role="gridcell"
        aria-label={`row ${row + 1}, column ${col + 1}${value ? ', filled' : ', empty'}`}
      />
    );
  });
});

const BoardView = forwardRef<HTMLDivElement, Props>(function Board(
  { board, geom, preview, clearFx, floats, shake, onCellEnter, onCellClick, dimmed, dragging },
  ref,
) {
  const { stride, cell, gap } = geom;
  const activeClear = clearFx[clearFx.length - 1];

  return (
    <div
      ref={ref}
      className={`board${shake ? ` shake shake-${Math.min(shake, 4)}` : ''}${dimmed ? ' dimmed' : ''}${dragging ? ' drag-active' : ''}`}
      style={{ '--gap': `${gap}px` } as React.CSSProperties}
      role="grid"
      aria-label="Game board"
    >
      <BoardCells
        board={board}
        geom={geom}
        preview={preview}
        onCellEnter={onCellEnter}
        onCellClick={onCellClick}
      />

      {/* Cleared cells are drawn on top as they were, because the engine has
          already taken them off the board. One board state, no stale copy. */}
      {clearFx.map((fx) =>
        fx.cells.map(({ index, color }) => (
          <div
            key={`${fx.id}-${index}`}
            className={`cell clearing clear-tier-${fx.tier}`}
            style={{
              left: (index % SIZE) * stride,
              top: Math.floor(index / SIZE) * stride,
              width: cell,
              height: cell,
              animationDelay: `${((index % SIZE) + Math.floor(index / SIZE)) * 8}ms`,
              ...colorVars(color),
            }}
          />
        )),
      )}

      {/* One compositor-friendly ring carries combo intensity for the whole
          clear. Per-cell glow filters multiply quickly on a full line. */}
      {activeClear && (
        <div
          key={activeClear.id}
          className="board-clear-ring"
          data-chain-tier={activeClear.tier}
          aria-hidden
        />
      )}

      {floats.map((f) => (
        <div
          key={f.id}
          className={`float float-${f.kind} combo-tier-${f.tier}`}
          style={{ left: f.col * stride + cell / 2, top: f.row * stride }}
        >
          {f.text}
        </div>
      ))}
    </div>
  );
});

/**
 * Pointer coordinates update the drag layer every animation frame. The board
 * only changes when the implied cell, game state, or effects change, so keep 64
 * cells out of those pixel-level renders.
 */
export const Board = memo(BoardView);
