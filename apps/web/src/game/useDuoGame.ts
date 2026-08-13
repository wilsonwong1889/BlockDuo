import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMove,
  decodeState,
  type GameState,
  type Move,
  type RoomSnapshot,
  type Seat,
  type ServerMessage,
} from '@blokduo/engine';
import * as sfx from '../audio/sfx';
import { roomSocketUrl } from '../net/config';
import { announceProgressChange, fetchRoomTicket } from '../progress/api';
import type { ClearFx, FloatFx } from './fx';
import { eventsForAppliedFeedback } from './feedback';
import { useGameFx } from './useGameFx';

export type DuoStatus = 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error';

export interface DuoGame {
  status: DuoStatus;
  error: string | null;
  seat: Seat | null;
  snapshot: RoomSnapshot | null;
  /** What to draw: the optimistic local board while a move is in flight. */
  state: GameState | null;
  myTurn: boolean;
  clearFx: ClearFx[];
  floats: FloatFx[];
  shake: number;
  lastEvent: string | null;
  commit: (move: Move) => boolean;
  reject: () => void;
  rematch: () => void;
}

const RECONNECT_DELAYS = [400, 900, 1800, 3000, 5000];

export function useDuoGame(code: string, name: string): DuoGame {
  const [status, setStatus] = useState<DuoStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [optimistic, setOptimistic] = useState<GameState | null>(null);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const {
    clearFx,
    floats,
    shake,
    playMove,
    playGameOver,
  } = useGameFx();

  /** The socket currently considered live. Anything else is a leftover. */
  const ws = useRef<WebSocket | null>(null);
  const seq = useRef(0);
  const timers = useRef<Set<number>>(new Set());
  const seatRef = useRef<Seat | null>(null);
  const snapshotRef = useRef<RoomSnapshot | null>(null);
  const optimisticRef = useRef<GameState | null>(null);
  const announcedResult = useRef('');

  seatRef.current = seat;
  snapshotRef.current = snapshot;
  optimisticRef.current = optimistic;

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  const serverState = useMemo(
    () => (snapshot ? decodeState(snapshot.game) : null),
    [snapshot],
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

    const connect = async () => {
      if (cancelled) return;
      let ticket: string;
      try {
        ticket = await fetchRoomTicket(code, name);
      } catch (cause) {
        if (cancelled) return;
        setStatus('reconnecting');
        setError(cause instanceof Error ? cause.message : 'Could not join the room');
        const delay = RECONNECT_DELAYS[Math.min(retry, RECONNECT_DELAYS.length - 1)];
        retry += 1;
        retryTimers.push(window.setTimeout(() => void connect(), delay));
        return;
      }
      if (cancelled) return;

      const mine = new WebSocket(roomSocketUrl(code, ticket));
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
        retryTimers.push(window.setTimeout(() => void connect(), delay));
      };
    };

    const handle = (msg: ServerMessage) => {
      const adoptSnapshot = (next: RoomSnapshot) => {
        snapshotRef.current = next;
        optimisticRef.current = null;
        setSnapshot(next);
        setOptimistic(null);
      };

      switch (msg.t) {
        case 'welcome':
          seatRef.current = msg.seat;
          setSeat(msg.seat);
          adoptSnapshot(msg.snapshot);
          if (
            msg.snapshot.phase === 'over' &&
            msg.snapshot.result?.reward &&
            msg.snapshot.result.settled &&
            announcedResult.current !== msg.snapshot.result.id
          ) {
            announcedResult.current = msg.snapshot.result.id;
            playGameOver();
            announceProgressChange();
          }
          break;

        case 'state':
          adoptSnapshot(msg.snapshot);
          break;

        case 'applied': {
          const before = optimisticRef.current ?? (snapshotRef.current ? decodeState(snapshotRef.current.game) : null);
          // My own move already played its sound and animation optimistically.
          // Replaying it here would double every effect.
          if (msg.by !== seatRef.current && before) {
            const after = decodeState(msg.snapshot.game);
            playMove(
              before,
              eventsForAppliedFeedback(before, after, msg),
              { slot: msg.slot, row: msg.row, col: msg.col },
              // Partner clears keep their shared sound/visual celebration, but
              // only the person who placed a piece gets device vibration.
              { hapticFeedback: false },
            );
          }
          adoptSnapshot(msg.snapshot);
          if (msg.snapshot.turn === seatRef.current && msg.snapshot.phase === 'playing') {
            sfx.playYourTurn();
          }
          break;
        }

        case 'rejected':
          // The server is the authority: roll straight back to its board.
          adoptSnapshot(msg.snapshot);
          sfx.playReject();
          setLastEvent(reasonText(msg.reason));
          schedule(() => setLastEvent(null), 2600);
          break;

        case 'timeout':
          adoptSnapshot(msg.snapshot);
          setLastEvent(
            msg.seat === seatRef.current ? 'You ran out of time' : 'Partner ran out of time',
          );
          schedule(() => setLastEvent(null), 2600);
          break;

        case 'over':
          adoptSnapshot(msg.snapshot);
          playGameOver();
          if (
            msg.snapshot.result?.reward &&
            msg.snapshot.result.settled &&
            announcedResult.current !== msg.snapshot.result.id
          ) {
            announcedResult.current = msg.snapshot.result.id;
            announceProgressChange();
          }
          break;

        case 'error':
          setError(msg.message);
          break;

        default:
          break;
      }
    };

    void connect();

    return () => {
      cancelled = true;
      retryTimers.forEach(clearTimeout);
      timers.current.forEach(clearTimeout);
      timers.current.clear();
      if (ws.current === socket) ws.current = null;
      socket?.close(1000, 'leaving');
    };
  }, [code, name, playGameOver, playMove, schedule]);

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
      const socket = ws.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;

      const res = applyMove(current, move);
      if (!res.ok) return false;

      seq.current += 1;
      try {
        socket.send(
          JSON.stringify({
            t: 'place',
            seq: seq.current,
            slot: move.slot,
            row: move.row,
            col: move.col,
          }),
        );
      } catch {
        return false;
      }

      // Play it locally at once and let the server confirm. At any normal
      // latency the confirmation lands before the drop animation finishes, so
      // the game feels local even though the server decides.
      optimisticRef.current = res.result.state;
      setOptimistic(res.result.state);
      playMove(current, res.result.events, move);
      return true;
    },
    [playMove],
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
