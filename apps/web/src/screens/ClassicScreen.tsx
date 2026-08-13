import { useCallback, useEffect } from 'react';
import { Board } from '../components/Board';
import { DragLayer } from '../components/DragLayer';
import { GameOver } from '../components/GameOver';
import { Hud } from '../components/Hud';
import { Tray } from '../components/Tray';
import { useClassicGame } from '../game/useClassicGame';
import { useGeometry, usePlacement } from '../game/usePlacement';

interface Props {
  onHome: () => void;
}

export function ClassicScreen({ onHome }: Props) {
  const { geom, boardRef, measureNow } = useGeometry();
  const game = useClassicGame();

  const placement = usePlacement(
    game.state.board,
    game.state.hand,
    geom,
    game.commit,
    game.reject,
    !game.state.over,
    measureNow,
  );

  const { toggleSelect, moveCursor, placeAtCursor, clearSelection, selected } = placement;

  // Full keyboard play: pick a piece with 1-3, aim with the arrows, drop with
  // Enter. Nothing in the game requires a pointer.
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (game.state.over) return;
      if (e.key >= '1' && e.key <= '3') {
        toggleSelect(Number(e.key) - 1);
        e.preventDefault();
      } else if (selected !== null) {
        const deltas: Record<string, [number, number]> = {
          ArrowUp: [-1, 0],
          ArrowDown: [1, 0],
          ArrowLeft: [0, -1],
          ArrowRight: [0, 1],
        };
        if (deltas[e.key]) {
          moveCursor(...deltas[e.key]);
          e.preventDefault();
        } else if (e.key === 'Enter' || e.key === ' ') {
          placeAtCursor();
          e.preventDefault();
        } else if (e.key === 'Escape') {
          clearSelection();
        }
      }
    },
    [game.state.over, selected, toggleSelect, moveCursor, placeAtCursor, clearSelection],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  return (
    <div className="screen game-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onHome} aria-label="Back to menu">
          ‹
        </button>
        <span className="topbar-title">Classic</span>
        <button className="icon-btn" onClick={game.restart} aria-label="Restart game">
          ↻
        </button>
      </header>

      <Hud score={game.state.score} best={game.best} streak={game.state.streak} />

      <div className="board-wrap">
        <Board
          ref={boardRef}
          board={game.state.board}
          geom={geom}
          preview={placement.preview}
          clearFx={game.clearFx}
          floats={game.floats}
          shake={game.shake}
          onCellEnter={selected !== null ? placement.setCursor : undefined}
          onCellClick={selected !== null ? placeAtCursor : undefined}
          dimmed={game.state.over}
          dragging={placement.drag !== null}
        />
      </div>

      <Tray
        hand={game.state.hand}
        board={game.state.board}
        boardStride={geom.stride}
        gap={geom.gap}
        selected={placement.selected}
        draggingSlot={placement.drag?.slot ?? null}
        disabled={game.state.over}
        onStart={placement.startDrag}
        onSelect={toggleSelect}
      />

      <DragLayer
        drag={placement.drag}
        geom={geom}
        valid={placement.preview?.valid ?? false}
        positionRef={placement.dragPositionRef}
      />

      {game.state.over && (
        <GameOver
          score={game.state.score}
          best={game.best}
          stats={[
            { label: 'Lines', value: game.state.linesCleared },
            { label: 'Pieces', value: game.state.moveCount },
            { label: 'Best streak', value: game.state.bestStreak },
          ]}
          reward={game.reward}
          rewardStatus={game.rewardStatus}
          onPrimary={game.restart}
          onHome={onHome}
        />
      )}
    </div>
  );
}
