import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyMove,
  coinReward,
  newGame,
  type CoinReward,
  type GameState,
  type Move,
} from '@blokduo/engine';
import * as sfx from '../audio/sfx';
import { useProgress } from '../progress/ProgressContext';
import {
  loadBest,
  loadClassicGame,
  queuePendingClassic,
  saveBest,
  saveGame,
} from '../storage';
import type { ClearFx, FloatFx } from './fx';
import { useGameFx } from './useGameFx';
import { createDeferredTask } from '../performance/deferredTask';

export type { ClearFx, FloatFx };

export interface ClassicGame {
  state: GameState;
  best: number;
  clearFx: ClearFx[];
  floats: FloatFx[];
  shake: number;
  reward: CoinReward | null;
  rewardStatus: 'pending' | 'awarded' | 'queued' | 'unavailable' | null;
  commit: (move: Move) => boolean;
  restart: () => void;
  reject: () => void;
}

export function useClassicGame(startFresh = false): ClassicGame {
  const [initial] = useState(() => (startFresh ? null : loadClassicGame()));
  const [state, setState] = useState<GameState>(() => initial?.state ?? newGame());
  const [best, setBest] = useState<number>(() => loadBest());
  const [rewardStatus, setRewardStatus] = useState<ClassicGame['rewardStatus']>(null);
  const movesRef = useRef<Move[]>(initial?.moves ?? []);
  const bestRef = useRef(best);
  const persistedRef = useRef({ state, moves: movesRef.current, best });
  const saveTaskRef = useRef<ReturnType<typeof createDeferredTask> | null>(null);
  const rewardEligibleRef = useRef(initial?.rewardEligible ?? true);
  const claimKeyRef = useRef('');
  const { claimClassic } = useProgress();
  const { clearFx, floats, shake, playMove, resetFx } = useGameFx();

  // Local storage serialisation is synchronous and can visibly interrupt a
  // clear on slower phones. Keep the latest snapshot in memory, coalesce rapid
  // moves, then checkpoint only when the browser is quiet (or after ten
  // seconds at most). Backgrounding/navigation always flushes immediately.
  if (!saveTaskRef.current) {
    saveTaskRef.current = createDeferredTask(
      () => {
        const pending = persistedRef.current;
        saveGame(pending.state, pending.moves);
        saveBest(pending.best);
      },
      2_000,
      10_000,
    );
  }

  useEffect(() => {
    const flush = () => saveTaskRef.current?.flush();
    const onVisibility = () => document.hidden && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, []);

  useEffect(() => {
    if (startFresh) saveGame(null);
  }, [startFresh]);

  useEffect(() => {
    if (!state.over) return;
    const transcript = movesRef.current.map((move) => ({ ...move }));
    const key = `${state.seed}:${JSON.stringify(transcript)}`;
    let settled = false;
    let persisted = false;

    const persistCompletion = () => {
      if (persisted) return;
      persisted = true;
      if (rewardEligibleRef.current) queuePendingClassic({ seed: state.seed, moves: transcript });
    };

    // Both outcomes are already known here, so the card opens in its final
    // shape. Waiting for the settle timer to set this meant the dialog appeared
    // with no status, grew a "Saving reward…" line a second later, and dropped
    // it again on success — two layout shifts under the player's eyes.
    setRewardStatus(rewardEligibleRef.current ? 'pending' : 'unavailable');

    const settle = () => {
      if (settled || claimKeyRef.current === key) return;
      settled = true;
      claimKeyRef.current = key;
      persistCompletion();
      if (!rewardEligibleRef.current) return;
      void claimClassic(state.seed, transcript).then((result) => {
        if (claimKeyRef.current !== key) return;
        setRewardStatus(result ? 'awarded' : 'queued');
      });
    };

    // Let the last clear, score roll, and game-over transition finish before
    // serialising the transcript or starting a request to the progression site.
    const timer = window.setTimeout(settle, 1_800);
    const persistBeforeSuspend = () => persistCompletion();
    const persistWhenHidden = () => document.hidden && persistCompletion();
    window.addEventListener('pagehide', persistBeforeSuspend);
    document.addEventListener('visibilitychange', persistWhenHidden);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', persistBeforeSuspend);
      document.removeEventListener('visibilitychange', persistWhenHidden);
      if (!settled) persistCompletion();
    };
  }, [claimClassic, state.over, state.seed]);

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
    movesRef.current = [...movesRef.current, move];
    const nextBest = Math.max(bestRef.current, next.score);
    persistedRef.current = { state: next, moves: movesRef.current, best: nextBest };
    stateRef.current = next;
    setState(next);
    saveTaskRef.current?.schedule();

    playMove(current, events, move, { gameOverSound: true, prioritizeVisuals: true });

    if (nextBest > bestRef.current) {
      bestRef.current = nextBest;
      setBest(nextBest);
    }
    return true;
  }, [playMove]);

  const restart = useCallback(() => {
    resetFx();
    saveTaskRef.current?.cancel();
    saveGame(null);
    const fresh = newGame();
    movesRef.current = [];
    persistedRef.current = { state: fresh, moves: [], best: bestRef.current };
    rewardEligibleRef.current = true;
    claimKeyRef.current = '';
    setRewardStatus(null);
    stateRef.current = fresh;
    setState(fresh);
  }, [resetFx]);

  const reject = useCallback(() => sfx.playReject(), []);

  return {
    state,
    best,
    clearFx,
    floats,
    shake,
    reward: state.over ? coinReward(state.score, state.moveCount) : null,
    rewardStatus,
    commit,
    restart,
    reject,
  };
}
