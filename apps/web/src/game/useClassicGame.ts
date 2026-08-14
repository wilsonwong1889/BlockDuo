import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyAction,
  canUndo as sessionCanUndo,
  coinReward,
  newSession,
  POWER_COSTS,
  sessionFrom,
  undosLeft as sessionUndosLeft,
  type CoinReward,
  type GameAction,
  type GameState,
  type Move,
  type PowerName,
  type Session,
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
  /** Gem-bought powers. Each resolves false when it was not paid for or not legal. */
  usePower: (power: PowerName, slot?: number) => Promise<boolean>;
  canUndo: boolean;
  undosLeft: number;
  powerCosts: typeof POWER_COSTS;
}

export function useClassicGame(startFresh = false): ClassicGame {
  const [initial] = useState(() => (startFresh ? null : loadClassicGame()));
  // The session carries the few states behind the current one that an undo can
  // return to; a resumed game starts with none, so undos are per sitting.
  const [session, setSession] = useState<Session>(() =>
    initial?.state ? sessionFrom(initial.state) : newSession(),
  );
  const state = session.state;
  const setState = (next: GameState) => setSession((s) => ({ ...s, state: next }));
  const [best, setBest] = useState<number>(() => loadBest());
  const [rewardStatus, setRewardStatus] = useState<ClassicGame['rewardStatus']>(null);
  const movesRef = useRef<GameAction[]>(initial?.moves ?? []);
  const bestRef = useRef(best);
  const persistedRef = useRef({ state, moves: movesRef.current, best });
  const saveTaskRef = useRef<ReturnType<typeof createDeferredTask> | null>(null);
  const rewardEligibleRef = useRef(initial?.rewardEligible ?? true);
  const claimKeyRef = useRef('');
  const { claimClassic, spendGems } = useProgress();
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
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const commit = useCallback((move: Move): boolean => {
    const current = sessionRef.current;
    const res = applyAction(current, move);
    if (!res.ok) return false;

    const next = res.session.state;
    const events = res.events;
    movesRef.current = [...movesRef.current, move];
    const nextBest = Math.max(bestRef.current, next.score);
    persistedRef.current = { state: next, moves: movesRef.current, best: nextBest };
    sessionRef.current = res.session;
    setSession(res.session);
    saveTaskRef.current?.schedule();

    playMove(current.state, events, move, { gameOverSound: true, prioritizeVisuals: true });

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
    const fresh = newSession();
    movesRef.current = [];
    persistedRef.current = { state: fresh.state, moves: [], best: bestRef.current };
    rewardEligibleRef.current = true;
    claimKeyRef.current = '';
    setRewardStatus(null);
    sessionRef.current = fresh;
    setSession(fresh);
  }, [resetFx]);

  /**
   * Buy and apply one power.
   *
   * Paid for before it is applied, and the gems are only spent if the action
   * was actually legal — asking the engine first means a rotation of an empty
   * slot costs nothing. The action joins the transcript so the server's replay
   * sees exactly the game that was played.
   */
  const usePower = useCallback(
    async (power: PowerName, slot?: number): Promise<boolean> => {
      const action: GameAction =
        power === 'rotate' ? { t: 'rotate', slot: slot ?? 0 } : { t: power };

      const dryRun = applyAction(sessionRef.current, action);
      if (!dryRun.ok) {
        sfx.playReject();
        return false;
      }

      if (!(await spendGems(power))) {
        sfx.playReject();
        return false;
      }

      // Re-applied against whatever the session is now: paying is a round trip,
      // and a piece could have been placed while it was in flight.
      const applied = applyAction(sessionRef.current, action);
      if (!applied.ok) return false;

      movesRef.current = [...movesRef.current, action];
      persistedRef.current = {
        state: applied.session.state,
        moves: movesRef.current,
        best: bestRef.current,
      };
      sessionRef.current = applied.session;
      setSession(applied.session);
      saveTaskRef.current?.schedule();
      resetFx();
      return true;
    },
    [resetFx, spendGems],
  );


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
    usePower,
    canUndo: sessionCanUndo(session),
    undosLeft: sessionUndosLeft(session),
    powerCosts: POWER_COSTS,
  };
}
