import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameEvent, GameState, Move } from '@blokduo/engine';
import * as sfx from '../audio/sfx';
import { haptic } from '../native';
import { buildClearFx, fxId, type ClearFx, type FloatFx } from './fx';
import {
  chainTier,
  feedbackFromEvents,
  feedbackText,
  type MoveFeedback,
} from './feedback';

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
    (before: GameState, move: Move, cellIndices: number[], feedback: MoveFeedback) => {
      const tier = chainTier(feedback.streakAfter);
      const effect = buildClearFx(
        before.board,
        before.hand[move.slot],
        move,
        cellIndices,
        feedback.lines,
        tier,
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
          text: feedbackText(feedback),
          kind: feedback.streakAfter >= 2 ? 'chain' : feedback.lines > 1 ? 'burst' : 'score',
          tier,
        },
      ]);
      schedule(
        () => setFloats((list) => list.filter((item) => item.id !== floatId)),
        900,
      );

      setShake(Math.max(feedback.lines, tier >= 3 ? 2 : 1));
      schedule(() => setShake(0), 340);
    },
    [schedule],
  );

  const showPerfect = useCallback(() => {
    const id = fxId();
    setFloats((list) => [
      ...list,
      { id, row: 3, col: 2, text: 'PERFECT!', kind: 'perfect', tier: 4 },
    ]);
    schedule(() => setFloats((list) => list.filter((item) => item.id !== id)), 1400);
  }, [schedule]);

  const playGameOver = useCallback(() => {
    schedule(() => sfx.playGameOver(), 400);
  }, [schedule]);

  const playMove = useCallback(
    (
      before: GameState,
      events: GameEvent[],
      move: Move,
      options: { gameOverSound?: boolean; hapticFeedback?: boolean } = {},
    ) => {
      const { gameOverSound = false, hapticFeedback = true } = options;
      const feedback = feedbackFromEvents(before, events);

      if (feedback.lines > 0) {
        sfx.playClear(feedback.lines, feedback.streakAfter);
        if (hapticFeedback) {
          void haptic(
            feedback.perfectPoints > 0 || feedback.lines > 1 || feedback.streakAfter >= 2
              ? 'combo'
              : 'clear',
          );
        }
      } else {
        sfx.playPlace();
        if (hapticFeedback) void haptic('place');
      }

      if (feedback.perfectPoints > 0) sfx.playPerfect();

      for (const event of events) {
        switch (event.type) {
          case 'placed':
            break;
          case 'cleared':
            showClear(before, move, event.cellIndices, feedback);
            break;
          case 'streak':
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
    playGameOver,
    resetFx,
  };
}
