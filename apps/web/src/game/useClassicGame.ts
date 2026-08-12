import { useCallback, useEffect, useRef, useState } from 'react';
import { applyMove, newGame, type GameEvent, type GameState, type Move } from '@blokduo/engine';
import * as sfx from '../audio/sfx';
import { loadBest, loadGame, saveBest, saveGame } from '../storage';
import { haptic } from '../native';
import { buildClearFx, fxId, type ClearFx, type FloatFx } from './fx';

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
  const [clearFx, setClearFx] = useState<ClearFx[]>([]);
  const [floats, setFloats] = useState<FloatFx[]>([]);
  const [shake, setShake] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout);
    };
  }, []);

  const schedule = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

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

    handleEvents(current, events, move, { setClearFx, setFloats, setShake, schedule });

    setBest((b) => {
      if (next.score <= b) return b;
      saveBest(next.score);
      return next.score;
    });
    saveGame(next);
    return true;
  }, []);

  const restart = useCallback(() => {
    setClearFx([]);
    setFloats([]);
    setShake(0);
    saveGame(null);
    const fresh = newGame();
    stateRef.current = fresh;
    setState(fresh);
  }, []);

  const reject = useCallback(() => sfx.playReject(), []);

  return { state, best, clearFx, floats, shake, commit, restart, reject };
}

interface FxSetters {
  setClearFx: React.Dispatch<React.SetStateAction<ClearFx[]>>;
  setFloats: React.Dispatch<React.SetStateAction<FloatFx[]>>;
  setShake: React.Dispatch<React.SetStateAction<number>>;
  schedule: (fn: () => void, ms: number) => void;
}

/**
 * Turn engine events into sound and animation.
 *
 * The engine has already removed cleared cells from the board, so the clear
 * animation is drawn as an overlay of the cells *as they were* — that way there
 * is only ever one board state, and no need to keep a stale copy around for the
 * duration of the animation.
 */
function handleEvents(
  before: GameState,
  events: GameEvent[],
  move: Move,
  { setClearFx, setFloats, setShake, schedule }: FxSetters,
) {
  let clearedLines = 0;

  for (const event of events) {
    switch (event.type) {
      case 'placed': {
        sfx.playPlace();
        void haptic('place');
        break;
      }
      case 'cleared': {
        clearedLines = event.rows.length + event.cols.length;
        const fx = buildClearFx(
          before.board,
          before.hand[move.slot],
          move,
          event.cellIndices,
          clearedLines,
        );
        const id = fx.id;
        setClearFx((list) => [...list, fx]);
        schedule(() => setClearFx((list) => list.filter((f) => f.id !== id)), 520);

        const floatId = fxId();
        setFloats((f) => [
          ...f,
          {
            id: floatId,
            row: move.row,
            col: move.col,
            text: `+${event.points}`,
            kind: clearedLines > 1 ? 'combo' : 'score',
          },
        ]);
        schedule(() => setFloats((f) => f.filter((x) => x.id !== floatId)), 900);

        setShake(clearedLines);
        schedule(() => setShake(0), 340);
        break;
      }
      case 'streak': {
        sfx.playClear(clearedLines || 1, event.streak - 1);
        void haptic(clearedLines > 1 ? 'combo' : 'clear');
        break;
      }
      case 'perfect': {
        sfx.playPerfect();
        const id = fxId();
        setFloats((f) => [...f, { id, row: 3, col: 2, text: 'PERFECT!', kind: 'perfect' }]);
        schedule(() => setFloats((f) => f.filter((x) => x.id !== id)), 1400);
        break;
      }
      case 'gameover': {
        schedule(() => sfx.playGameOver(), 400);
        break;
      }
      default:
        break;
    }
  }
}
