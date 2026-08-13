import { useCallback, useEffect, useRef, useState } from 'react';
import { applyMove, newGame, type GameState, type Move } from '@blokduo/engine';
import * as sfx from '../audio/sfx';
import { loadBest, loadGame, saveBest, saveGame } from '../storage';
import type { ClearFx, FloatFx } from './fx';
import { useGameFx } from './useGameFx';

export type { ClearFx, FloatFx };

export interface ClassicGame {
  state: GameState;
  best: number;
  clearFx: ClearFx[];
  floats: FloatFx[];
  shake: number;
  commit: (move: Move) => boolean;
  restart: () => void;
  reject: () => void;
}

export function useClassicGame(): ClassicGame {
  const [state, setState] = useState<GameState>(() => loadGame() ?? newGame());
  const [best, setBest] = useState<number>(() => loadBest());
  const { clearFx, floats, shake, playMove, resetFx } = useGameFx();

  // Persistence runs after React commits the move, keeping synchronous storage
  // work out of the pointer-up hot path.
  useEffect(() => saveGame(state), [state]);

  // The authoritative state is kept in a ref alongside React state.
  //
  // Applying a move has to happen outside the setState updater: the updater is
  // invoked twice under StrictMode, which would double-play the sound effects
  // and double-schedule every animation. It also lets `commit` report
  // synchronously whether the move was legal, which the drag handler needs in
  // order to decide between snapping the piece home and dropping it.
  const stateRef = useRef(state);
  stateRef.current = state;

  const commit = useCallback((move: Move): boolean => {
    const current = stateRef.current;
    const res = applyMove(current, move);
    if (!res.ok) return false;

    const { state: next, events } = res.result;
    stateRef.current = next;
    setState(next);

    playMove(current, events, move, true);

    setBest((b) => {
      if (next.score <= b) return b;
      saveBest(next.score);
      return next.score;
    });
    return true;
  }, [playMove]);

  const restart = useCallback(() => {
    resetFx();
    saveGame(null);
    const fresh = newGame();
    stateRef.current = fresh;
    setState(fresh);
  }, [resetFx]);

  const reject = useCallback(() => sfx.playReject(), []);

  return { state, best, clearFx, floats, shake, commit, restart, reject };
}
