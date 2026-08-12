import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMove,
  decodeState,
  type GameEvent,
  type GameState,
  type Move,
  type RoomSnapshot,
  type Seat,
  type ServerMessage,
} from '@blokduo/engine';
import * as sfx from '../audio/sfx';
import { haptic } from '../native';
import { roomSocketUrl } from '../net/config';
import { buildClearFx, fxId, type ClearFx, type FloatFx } from './fx';

export type DuoStatus = 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error';

export interface DuoGame {
  status: DuoStatus;
  error: string | null;
  seat: Seat | null;
  snapshot: RoomSnapshot | null;
  /** What to draw: the optimistic local board while a move is in flight. */
  state: GameState | null;
  myTurn: boolean;
  secondsLeft: number | null;
  clearFx: ClearFx[];
  floats: FloatFx[];
  shake: number;
  lastEvent: string | null;
  commit: (move: Move) => boolean;
  reject: () => void;
  rematch: () => void;
}

const RECONNECT_DELAYS = [400, 900, 1800, 3000, 5000];

export function useDuoGame(code: string, clientId: string, name: string): DuoGame {
  const [status, setStatus] = useState<DuoStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [optimistic, setOptimistic] = useState<GameState | null>(null);
  const [clearFx, setClearFx] = useState<ClearFx[]>([]);
  const [floats, setFloats] = useState<FloatFx[]>([]);
  const [shake, setShake] = useState(0);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /** The socket currently considered live. Anything else is a leftover. */
  const ws = useRef<WebSocket | null>(null);
  const seq = useRef(0);
  /** serverNow minus local clock, so the turn timer does not trust the device. */
  const skew = useRef(0);
  const timers = useRef<number[]>([]);
  const seatRef = useRef<Seat | null>(null);
  const snapshotRef = useRef<RoomSnapshot | null>(null);
  const optimisticRef = useRef<GameState | null>(null);

  seatRef.current = seat;
  snapshotRef.current = snapshot;
  optimisticRef.current = optimistic;

  const schedule = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const serverState = useMemo(
    () => (snapshot ? decodeState(snapshot.game) : null),
    [snapshot],
  );

  // ------------------------------------------------------------- effects/audio

  const runClearFx = useCallback(
    (before: GameState, move: Move, cellIndices: number[], lines: number, points: number) => {
      const fx = buildClearFx(before.board, before.hand[move.slot], move, cellIndices, lines);
      setClearFx((list) => [...list, fx]);
      schedule(() => setClearFx((list) => list.filter((f) => f.id !== fx.id)), 520);

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
      schedule(() => setFloats((list) => list.filter((f) => f.id !== floatId)), 900);

      setShake(lines);
      schedule(() => setShake(0), 340);
    },
    [schedule],
  );

  const runLocalEvents = useCallback(
    (before: GameState, events: GameEvent[], move: Move) => {
      let lines = 0;
      for (const event of events) {
        if (event.type === 'placed') {
          sfx.playPlace();
          void haptic('place');
        }
        if (event.type === 'cleared') {
          lines = event.rows.length + event.cols.length;
          runClearFx(before, move, event.cellIndices, lines, event.points);
        }
        if (event.type === 'streak') {
          sfx.playClear(lines || 1, event.streak - 1);
          void haptic(lines > 1 ? 'combo' : 'clear');
        }
        if (event.type === 'perfect') {
          sfx.playPerfect();
          const id = fxId();
          setFloats((list) => [...list, { id, row: 3, col: 2, text: 'PERFECT!', kind: 'perfect' }]);
          schedule(() => setFloats((list) => list.filter((f) => f.id !== id)), 1400);
        }
      }
    },
    [runClearFx, schedule],
  );

  // -------------------------------------------------------------- socket wiring

  useEffect(() => {
    // Cancellation is scoped to this effect run, not held in a ref.
    //
    // A ref is shared by every invocation, so under StrictMode's mount/unmount/
    // remount the first socket's close arrives after the second mount has
    // already cleared the flag — the dead socket then reconnects, replaces the
    // live one, and every close after that does the same. That is a reconnect
    // storm against the server, from a client that looks idle.
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retry = 0;
    const retryTimers: number[] = [];

    const connect = () => {
      if (cancelled) return;
      const mine = new WebSocket(roomSocketUrl(code, clientId, name));
      socket = mine;
      ws.current = mine;

      mine.onopen = () => {
        if (cancelled || ws.current !== mine) return;
        retry = 0;
        setStatus('live');
        setError(null);
      };

      mine.onmessage = (raw) => {
        if (cancelled || ws.current !== mine) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(raw.data as string) as ServerMessage;
        } catch {
          return;
        }
        handle(msg);
      };

      mine.onerror = () => {
        // `onclose` always follows and carries what matters, so the retry is
        // driven from there alone.
      };

      mine.onclose = () => {
        // Only the socket still holding the connection may schedule a retry.
        if (cancelled || ws.current !== mine) return;
        const delay = RECONNECT_DELAYS[Math.min(retry, RECONNECT_DELAYS.length - 1)];
        retry += 1;
        setStatus('reconnecting');
        retryTimers.push(window.setTimeout(connect, delay));
      };
    };

    const handle = (msg: ServerMessage) => {
      if ('snapshot' in msg) {
        skew.current = msg.snapshot.serverNow - Date.now();
      }

      switch (msg.t) {
        case 'welcome':
          setSeat(msg.seat);
          setSnapshot(msg.snapshot);
          setOptimistic(null);
          break;

        case 'state':
          setSnapshot(msg.snapshot);
          setOptimistic(null);
          break;

        case 'applied': {
          const before = optimisticRef.current ?? (snapshotRef.current ? decodeState(snapshotRef.current.game) : null);
          // My own move already played its sound and animation optimistically.
          // Replaying it here would double every effect.
          if (msg.by !== seatRef.current && before) {
            sfx.playPlace();
            if (msg.clears) {
              const lines = msg.clears.rows.length + msg.clears.cols.length;
              runClearFx(
                before,
                { slot: msg.slot, row: msg.row, col: msg.col },
                msg.clears.cellIndices,
                lines,
                msg.scoreDelta,
              );
              sfx.playClear(lines, decodeState(msg.snapshot.game).streak - 1);
            }
            if (msg.perfect) sfx.playPerfect();
          }
          setSnapshot(msg.snapshot);
          setOptimistic(null);
          if (msg.snapshot.turn === seatRef.current && msg.snapshot.phase === 'playing') {
            sfx.playYourTurn();
          }
          break;
        }

        case 'rejected':
          // The server is the authority: roll straight back to its board.
          setSnapshot(msg.snapshot);
          setOptimistic(null);
          sfx.playReject();
          setLastEvent(reasonText(msg.reason));
          schedule(() => setLastEvent(null), 2600);
          break;

        case 'timeout':
          setSnapshot(msg.snapshot);
          setOptimistic(null);
          setLastEvent(
            msg.seat === seatRef.current ? 'You ran out of time' : 'Partner ran out of time',
          );
          schedule(() => setLastEvent(null), 2600);
          break;

        case 'over':
          setSnapshot(msg.snapshot);
          setOptimistic(null);
          schedule(() => sfx.playGameOver(), 400);
          break;

        case 'error':
          setError(msg.message);
          break;

        default:
          break;
      }
    };

    connect();

    return () => {
      cancelled = true;
      retryTimers.forEach(clearTimeout);
      timers.current.forEach(clearTimeout);
      timers.current = [];
      if (ws.current === socket) ws.current = null;
      socket?.close(1000, 'leaving');
    };
  }, [code, clientId, name, runClearFx, schedule]);

  // The turn clock is redrawn once a second rather than on every frame; it is
  // only ever shown to the nearest second.
  useEffect(() => {
    if (!snapshot?.deadline) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [snapshot?.deadline]);

  const secondsLeft = useMemo(() => {
    if (!snapshot?.deadline) return null;
    void tick;
    return Math.max(0, Math.ceil((snapshot.deadline - (Date.now() + skew.current)) / 1000));
  }, [snapshot?.deadline, tick]);

  // ------------------------------------------------------------------- actions

  const state = optimistic ?? serverState;
  const myTurn =
    !!snapshot &&
    snapshot.phase === 'playing' &&
    snapshot.turn === seat &&
    optimistic === null &&
    status === 'live';

  const commit = useCallback(
    (move: Move): boolean => {
      const current = optimisticRef.current ?? (snapshotRef.current ? decodeState(snapshotRef.current.game) : null);
      const snap = snapshotRef.current;
      if (!current || !snap || snap.phase !== 'playing' || snap.turn !== seatRef.current) return false;
      if (optimisticRef.current) return false;

      const res = applyMove(current, move);
      if (!res.ok) return false;

      // Play it locally at once and let the server confirm. At any normal
      // latency the confirmation lands before the drop animation finishes, so
      // the game feels local even though the server decides.
      setOptimistic(res.result.state);
      runLocalEvents(current, res.result.events, move);

      seq.current += 1;
      ws.current?.send(
        JSON.stringify({ t: 'place', seq: seq.current, slot: move.slot, row: move.row, col: move.col }),
      );
      return true;
    },
    [runLocalEvents],
  );

  const rematch = useCallback(() => {
    ws.current?.send(JSON.stringify({ t: 'rematch' }));
  }, []);

  const reject = useCallback(() => sfx.playReject(), []);

  return {
    status,
    error,
    seat,
    snapshot,
    state,
    myTurn,
    secondsLeft,
    clearFx,
    floats,
    shake,
    lastEvent,
    commit,
    reject,
    rematch,
  };
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'not-your-turn':
      return "It's not your turn";
    case 'occupied':
      return 'That space is taken';
    case 'out-of-bounds':
      return "That doesn't fit on the board";
    case 'empty-slot':
      return 'That piece is already played';
    case 'not-playing':
      return 'Waiting for the game to start';
    default:
      return 'That move was rejected';
  }
}
