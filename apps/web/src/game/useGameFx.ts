import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameEvent, GameState, Move } from '@blokduo/engine';
import * as sfx from '../audio/sfx';
import { haptic } from '../native';
import { buildClearFx, fxId, type ClearFx, type FloatFx } from './fx';

/** Shared animation and feedback pipeline for Classic and Duo moves. */
export function useGameFx() {
  const [clearFx, setClearFx] = useState<ClearFx[]>([]);
  const [floats, setFloats] = useState<FloatFx[]>([]);
  const [shake, setShake] = useState(0);
  const timers = useRef<Set<number>>(new Set());

  const cancelTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  useEffect(() => cancelTimers, [cancelTimers]);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  const showClear = useCallback(
    (before: GameState, move: Move, cellIndices: number[], lines: number, points: number) => {
      const effect = buildClearFx(
        before.board,
        before.hand[move.slot],
        move,
        cellIndices,
        lines,
      );
      setClearFx((list) => [...list, effect]);
      schedule(
        () => setClearFx((list) => list.filter((item) => item.id !== effect.id)),
        520,
      );

      const floatId = fxId();
      setFloats((list) => [
        ...list,
        {
          id: floatId,
          row: move.row,
          col: move.col,
          text: `+${points}`,
          kind: lines > 1 ? 'combo' : 'score',
        },
      ]);
      schedule(
        () => setFloats((list) => list.filter((item) => item.id !== floatId)),
        900,
      );

      setShake(lines);
      schedule(() => setShake(0), 340);
    },
    [schedule],
  );

  const showPerfect = useCallback(() => {
    sfx.playPerfect();
    const id = fxId();
    setFloats((list) => [
      ...list,
      { id, row: 3, col: 2, text: 'PERFECT!', kind: 'perfect' },
    ]);
    schedule(() => setFloats((list) => list.filter((item) => item.id !== id)), 1400);
  }, [schedule]);

  const playGameOver = useCallback(() => {
    schedule(() => sfx.playGameOver(), 400);
  }, [schedule]);

  const playMove = useCallback(
    (before: GameState, events: GameEvent[], move: Move, gameOverSound: boolean) => {
      let clearedLines = 0;

      for (const event of events) {
        switch (event.type) {
          case 'placed':
            sfx.playPlace();
            void haptic('place');
            break;
          case 'cleared':
            clearedLines = event.rows.length + event.cols.length;
            showClear(before, move, event.cellIndices, clearedLines, event.points);
            break;
          case 'streak':
            sfx.playClear(clearedLines || 1, event.streak - 1);
            void haptic(clearedLines > 1 ? 'combo' : 'clear');
            break;
          case 'perfect':
            showPerfect();
            break;
          case 'gameover':
            if (gameOverSound) playGameOver();
            break;
          default:
            break;
        }
      }
    },
    [playGameOver, showClear, showPerfect],
  );

  const resetFx = useCallback(() => {
    cancelTimers();
    setClearFx([]);
    setFloats([]);
    setShake(0);
  }, [cancelTimers]);

  return {
    clearFx,
    floats,
    shake,
    playMove,
    showClear,
    showPerfect,
    playGameOver,
    resetFx,
  };
}
