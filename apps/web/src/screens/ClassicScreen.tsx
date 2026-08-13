import { useCallback, useEffect, useState } from 'react';
import { Board } from '../components/Board';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DragLayer } from '../components/DragLayer';
import { GameOver } from '../components/GameOver';
import { Hud } from '../components/Hud';
import { Tray } from '../components/Tray';
import { useClassicGame } from '../game/useClassicGame';
import { useGeometry, usePlacement } from '../game/usePlacement';

interface Props {
  fresh?: boolean;
  onHome: () => void;
}

export function ClassicScreen({ fresh = false, onHome }: Props) {
  const { geom, boardRef, measureNow } = useGeometry();
  const game = useClassicGame(fresh);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);

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

  useEffect(() => {
    if (!game.state.over) {
      setShowGameOver(false);
      return;
    }
    // The final placement can also clear lines. Let that compositor animation
    // finish before mounting the full-screen blurred dialog.
    const timer = window.setTimeout(() => setShowGameOver(true), 520);
    return () => window.clearTimeout(timer);
  }, [game.state.over]);

  return (
    <div className="screen game-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onHome} aria-label="Back to menu">
          ‹
        </button>
        <span className="topbar-title">Classic</span>
        <button
          className="icon-btn"
          onClick={() => (game.state.moveCount > 0 && !game.state.over ? setConfirmRestart(true) : game.restart())}
          aria-label="Restart game"
        >
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
          dimmed={showGameOver}
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

      {showGameOver && (
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

      {confirmRestart && (
        <ConfirmDialog
          title="Restart Classic?"
          message="Your current board and score will be replaced with a new game."
          confirmLabel="Restart game"
          danger
          onConfirm={() => {
            setConfirmRestart(false);
            game.restart();
          }}
          onCancel={() => setConfirmRestart(false)}
        />
      )}
    </div>
  );
}
