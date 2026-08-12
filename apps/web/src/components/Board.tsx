import { forwardRef } from 'react';
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
}

export const Board = forwardRef<HTMLDivElement, Props>(function Board(
  { board, geom, preview, clearFx, floats, shake, onCellEnter, onCellClick, dimmed },
  ref,
) {
  const { stride, cell, gap } = geom;

  const previewSet = new Set(preview?.cells ?? []);
  const clearRowSet = new Set(preview?.clearRows ?? []);
  const clearColSet = new Set(preview?.clearCols ?? []);

  return (
    <div
      ref={ref}
      className={`board${shake ? ` shake shake-${Math.min(shake, 4)}` : ''}${dimmed ? ' dimmed' : ''}`}
      style={{ '--gap': `${gap}px` } as React.CSSProperties}
      role="grid"
      aria-label="Game board"
    >
      {Array.from({ length: CELLS }, (_, i) => {
        const row = Math.floor(i / SIZE);
        const col = i % SIZE;
        const value = board[i];
        const inPreview = previewSet.has(i);
        // A row or column that this placement would clear lights up, so you can
        // see the payoff before you commit to the drop.
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
      })}

      {/* Cleared cells are drawn on top as they were, because the engine has
          already taken them off the board. One board state, no stale copy. */}
      {clearFx.map((fx) =>
        fx.cells.map(({ index, color }) => (
          <div
            key={`${fx.id}-${index}`}
            className="cell clearing"
            style={{
              left: (index % SIZE) * stride,
              top: Math.floor(index / SIZE) * stride,
              width: cell,
              height: cell,
              animationDelay: `${((index % SIZE) + Math.floor(index / SIZE)) * 14}ms`,
              ...colorVars(color),
            }}
          />
        )),
      )}

      {floats.map((f) => (
        <div
          key={f.id}
          className={`float float-${f.kind}`}
          style={{ left: f.col * stride + cell / 2, top: f.row * stride }}
        >
          {f.text}
        </div>
      ))}
    </div>
  );
});
