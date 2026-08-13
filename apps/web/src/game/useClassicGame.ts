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

export function useClassicGame(): ClassicGame {
  const [initial] = useState(() => loadClassicGame());
  const [state, setState] = useState<GameState>(() => initial?.state ?? newGame());
  const [best, setBest] = useState<number>(() => loadBest());
  const [rewardStatus, setRewardStatus] = useState<ClassicGame['rewardStatus']>(null);
  const movesRef = useRef<Move[]>(initial?.moves ?? []);
  const rewardEligibleRef = useRef(initial?.rewardEligible ?? true);
  const claimKeyRef = useRef('');
  const { claimClassic } = useProgress();
  const { clearFx, floats, shake, playMove, resetFx } = useGameFx();

  // Persistence runs after React commits the move, keeping synchronous storage
  // work out of the pointer-up hot path.
  useEffect(() => saveGame(state, movesRef.current), [state]);

  useEffect(() => {
    if (!state.over) return;
    if (!rewardEligibleRef.current) {
      setRewardStatus('unavailable');
      return;
    }

    const key = `${state.seed}:${JSON.stringify(movesRef.current)}`;
    if (claimKeyRef.current === key) return;
    claimKeyRef.current = key;
    setRewardStatus('pending');
    const transcript = movesRef.current.map((move) => ({ ...move }));
    void claimClassic(state.seed, transcript).then((result) => {
      if (claimKeyRef.current !== key) return;
      setRewardStatus(result ? 'awarded' : 'queued');
    });
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
    if (next.over && rewardEligibleRef.current) {
      queuePendingClassic({ seed: next.seed, moves: movesRef.current });
    }
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
    movesRef.current = [];
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
