import { DurableObject } from 'cloudflare:workers';
import {
  MAX_CONSECUTIVE_TIMEOUTS,
  RECONNECT_GRACE_MS,
  ROOM_IDLE_MS,
  TURN_MS,
  applyMove,
  decodeState,
  encodeState,
  newGame,
  type ClientMessage,
  type PlayerView,
  type RoomSnapshot,
  type Seat,
  type ServerMessage,
  type WireGameState,
} from '@blokduo/engine';

export interface Env {
  ROOM: DurableObjectNamespace<RoomDO>;
  /** Optional overrides, in ms. Set in tests so the timers are observable. */
  TURN_MS?: string;
  RECONNECT_GRACE_MS?: string;
}

interface SeatState extends PlayerView {
  clientId: string;
  /**
   * Which connection currently owns this seat. A reconnect can open its new
   * socket before the old one's close is delivered, so a close is only allowed
   * to mark the seat away if it came from the socket still holding it.
   */
  connId: number;
  /** When this seat's connection dropped, or null while connected. */
  droppedAt: number | null;
  consecutiveTimeouts: number;
}

interface Room {
  code: string;
  phase: 'waiting' | 'playing' | 'over';
  game: WireGameState;
  turn: Seat;
  seats: (SeatState | null)[];
  deadline: number | null;
  /** Set while the clock is paused because the player to move is disconnected. */
  pausedAt: number | null;
  lastActivity: number;
  version: number;
  nextConnId: number;
}

interface Attachment {
  seat: Seat;
  clientId: string;
  connId: number;
}

/**
 * One Durable Object per room code.
 *
 * The object is the only authority on the game: clients send the move they want
 * to make and the server decides, using the same engine the client uses to
 * render. An out-of-turn or illegal move cannot be forced through, and a client
 * that has drifted gets a full snapshot back rather than being left wrong.
 */
export class RoomDO extends DurableObject<Env> {
  private room: Room | null = null;

  /** Real durations in production; shortened in tests so the alarms are testable. */
  private get turnMs(): number {
    return Number(this.env.TURN_MS ?? TURN_MS);
  }

  private get graceMs(): number {
    return Number(this.env.RECONNECT_GRACE_MS ?? RECONNECT_GRACE_MS);
  }

  // ---------------------------------------------------------------- lifecycle

  private async load(): Promise<Room | null> {
    if (!this.room) {
      this.room = (await this.ctx.storage.get<Room>('room')) ?? null;
    }
    return this.room;
  }

  /** Persist first, then keep the in-memory copy — the DO can be evicted at any point. */
  private async save(room: Room) {
    room.lastActivity = Date.now();
    this.room = room;
    await this.ctx.storage.put('room', room);
    await this.scheduleAlarm(room);
  }

  /** Create the room if it does not exist. Returns false if the code is taken. */
  async claim(code: string): Promise<boolean> {
    if (await this.load()) return false;
    const game = newGame();
    await this.save({
      code,
      phase: 'waiting',
      game: encodeState(game),
      turn: 0,
      seats: [null, null],
      deadline: null,
      pausedAt: null,
      lastActivity: Date.now(),
      version: 0,
      nextConnId: 1,
    });
    return true;
  }

  async status(): Promise<{ exists: boolean; open: boolean; players: number }> {
    const room = await this.load();
    if (!room) return { exists: false, open: false, players: 0 };
    const taken = room.seats.filter(Boolean).length;
    return { exists: true, open: taken < 2 && room.phase !== 'over', players: taken };
  }

  // ------------------------------------------------------------------ connect

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('clientId') ?? '';
    const name = (url.searchParams.get('name') || 'Player').slice(0, 20);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    // Whether the room exists is checked before anything about the request, so
    // a mistyped code always reports "no such room" rather than complaining
    // about a parameter the player never sees.
    const room = await this.load();
    if (!room) return new Response('No such room', { status: 404 });
    if (!clientId) return new Response('Missing clientId', { status: 400 });

    const seat = this.assignSeat(room, clientId, name);
    if (seat === null) return new Response('Room is full', { status: 409 });

    const connId = room.nextConnId++;
    room.seats[seat]!.connId = connId;

    // A reconnect from the same client replaces its old socket rather than
    // leaving a ghost that would receive broadcasts nobody reads.
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.clientId === clientId) ws.close(1000, 'replaced');
    }

    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat, clientId, connId } satisfies Attachment);

    await this.save(room);
    this.send(server, { t: 'welcome', seat, snapshot: this.snapshot(room) });
    this.broadcast({ t: 'state', snapshot: this.snapshot(room) }, server);

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /**
   * Reclaim a seat if this client already had one, otherwise take a free seat.
   * A disconnected player keeps their seat during the grace period, so a phone
   * that dropped Wi-Fi comes back to the same game rather than a stranger's.
   */
  private assignSeat(room: Room, clientId: string, name: string): Seat | null {
    const existing = room.seats.findIndex((s) => s?.clientId === clientId);
    if (existing >= 0) {
      const seat = room.seats[existing]!;
      seat.connected = true;
      seat.droppedAt = null;
      this.resumeClock(room);
      return existing as Seat;
    }

    const free = room.seats.findIndex((s) => s === null);
    if (free < 0) return null;

    room.seats[free] = {
      clientId,
      connId: 0,
      name,
      connected: true,
      ready: false,
      placements: 0,
      cellsPlaced: 0,
      linesCleared: 0,
      droppedAt: null,
      consecutiveTimeouts: 0,
    };

    if (room.seats.every(Boolean) && room.phase === 'waiting') {
      room.phase = 'playing';
      room.deadline = Date.now() + this.turnMs;
      room.pausedAt = null;
    }
    return free as Seat;
  }

  // ----------------------------------------------------------------- messages

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const att = ws.deserializeAttachment() as Attachment | null;
    const room = await this.load();
    if (!att || !room) return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      this.send(ws, { t: 'error', code: 'bad-json', message: 'Could not parse message' });
      return;
    }

    switch (msg.t) {
      case 'ping':
        this.send(ws, { t: 'pong', serverNow: Date.now() });
        return;
      case 'emote':
        this.broadcast({ t: 'emote', by: att.seat, id: String(msg.id).slice(0, 16) });
        return;
      case 'place':
        await this.handlePlace(ws, room, att.seat, msg);
        return;
      case 'rematch':
        await this.handleRematch(room, att.seat);
        return;
      default:
        this.send(ws, { t: 'error', code: 'unknown', message: 'Unknown message type' });
    }
  }

  private async handlePlace(
    ws: WebSocket,
    room: Room,
    seat: Seat,
    msg: Extract<ClientMessage, { t: 'place' }>,
  ) {
    const reject = (reason: string) =>
      this.send(ws, { t: 'rejected', seq: msg.seq, reason, snapshot: this.snapshot(room) });

    if (room.phase !== 'playing') return reject('not-playing');
    if (room.turn !== seat) return reject('not-your-turn');

    const before = decodeState(room.game);
    const result = applyMove(before, { slot: msg.slot, row: msg.row, col: msg.col });
    if (!result.ok) return reject(result.reason);

    const { state: after, events } = result.result;
    const cleared = events.find((e) => e.type === 'cleared');
    const perfect = events.some((e) => e.type === 'perfect');
    const placed = events.find((e) => e.type === 'placed');

    const player = room.seats[seat];
    if (player) {
      player.placements += 1;
      player.cellsPlaced += placed && placed.type === 'placed' ? placed.cells : 0;
      player.linesCleared += cleared && cleared.type === 'cleared' ? cleared.rows.length + cleared.cols.length : 0;
      player.consecutiveTimeouts = 0;
    }

    room.game = encodeState(after);
    room.version += 1;
    room.turn = this.nextSeat(room, seat);
    room.deadline = Date.now() + this.turnMs;
    room.pausedAt = null;
    if (after.over) {
      room.phase = 'over';
      room.deadline = null;
    }

    await this.save(room);

    this.broadcast({
      t: 'applied',
      by: seat,
      slot: msg.slot,
      row: msg.row,
      col: msg.col,
      clears:
        cleared && cleared.type === 'cleared'
          ? { rows: cleared.rows, cols: cleared.cols, cellIndices: cleared.cellIndices }
          : null,
      scoreDelta: after.score - before.score,
      perfect,
      snapshot: this.snapshot(room),
    });

    if (room.phase === 'over') this.broadcast({ t: 'over', snapshot: this.snapshot(room) });
  }

  private async handleRematch(room: Room, seat: Seat) {
    const player = room.seats[seat];
    if (!player) return;
    player.ready = true;

    const seated = room.seats.filter((s): s is SeatState => s !== null);
    const everyoneReady = seated.length > 0 && seated.every((s) => s.ready);
    if (!everyoneReady) {
      await this.save(room);
      this.broadcast({ t: 'state', snapshot: this.snapshot(room) });
      return;
    }

    room.game = encodeState(newGame());
    room.phase = seated.length === 2 ? 'playing' : 'waiting';
    room.version += 1;
    // The player who did not move last goes first, so a rematch does not hand
    // the same person the opening advantage twice.
    room.turn = this.nextSeat(room, room.turn);
    room.deadline = room.phase === 'playing' ? Date.now() + this.turnMs : null;
    room.pausedAt = null;
    for (const s of seated) {
      s.ready = false;
      s.placements = 0;
      s.cellsPlaced = 0;
      s.linesCleared = 0;
      s.consecutiveTimeouts = 0;
    }

    await this.save(room);
    this.broadcast({ t: 'state', snapshot: this.snapshot(room) });
  }

  // -------------------------------------------------------------- disconnects

  override async webSocketClose(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    const room = await this.load();
    if (!att || !room) return;

    const seat = room.seats[att.seat];
    if (!seat || seat.clientId !== att.clientId) return;
    // A newer connection already took this seat over — this close belongs to a
    // socket that has been superseded, so it says nothing about who is present.
    if (seat.connId !== att.connId) return;

    seat.connected = false;
    seat.droppedAt = Date.now();

    // Freeze the turn clock if it is the absent player's move — they should not
    // lose their turn to a dropped connection.
    if (room.phase === 'playing' && room.turn === att.seat && room.deadline !== null) {
      room.pausedAt = Date.now();
    }

    await this.save(room);
    this.broadcast({ t: 'state', snapshot: this.snapshot(room) });
  }

  override async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  private resumeClock(room: Room) {
    if (room.pausedAt !== null && room.deadline !== null) {
      room.deadline += Date.now() - room.pausedAt;
    }
    room.pausedAt = null;
  }

  // ------------------------------------------------------------------- alarms

  /**
   * A DO gets one alarm, so it is always set to whichever deadline comes first:
   * the current turn, a reconnect grace period, or idle cleanup.
   */
  private async scheduleAlarm(room: Room) {
    const candidates: number[] = [];
    if (room.phase === 'playing' && room.deadline !== null && room.pausedAt === null) {
      candidates.push(room.deadline);
    }
    for (const seat of room.seats) {
      if (seat && !seat.connected && seat.droppedAt !== null) {
        candidates.push(seat.droppedAt + this.graceMs);
      }
    }
    candidates.push(room.lastActivity + ROOM_IDLE_MS);

    const next = Math.min(...candidates);
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || Math.abs(existing - next) > 500) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  override async alarm() {
    const room = await this.load();
    if (!room) return;
    const now = Date.now();
    let changed = false;

    // A partner whose grace period ran out gives up their seat. The game keeps
    // going for whoever is still here rather than ending under them — and the
    // code still works, so the partner can come back into the free seat.
    for (let i = 0; i < room.seats.length; i++) {
      const seat = room.seats[i];
      if (seat && !seat.connected && seat.droppedAt !== null && now >= seat.droppedAt + this.graceMs) {
        room.seats[i] = null;
        changed = true;
        if (room.turn === i) {
          room.turn = this.nextSeat(room, i as Seat);
          room.deadline = now + this.turnMs;
        }
        room.pausedAt = null;
        if (!room.seats.some(Boolean)) {
          await this.ctx.storage.deleteAll();
          this.room = null;
          return;
        }
      }
    }

    if (room.phase === 'playing' && room.deadline !== null && room.pausedAt === null && now >= room.deadline) {
      const seat = room.seats[room.turn];
      if (seat) seat.consecutiveTimeouts += 1;
      const stalled = seat && seat.consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS;

      if (stalled) {
        room.phase = 'over';
        room.deadline = null;
      } else {
        // The turn passes rather than being auto-played: dropping someone's
        // piece somewhere they did not choose is worse than losing the turn.
        const timedOut = room.turn;
        room.turn = this.nextSeat(room, room.turn);
        room.deadline = now + this.turnMs;
        await this.save(room);
        this.broadcast({ t: 'timeout', seat: timedOut, snapshot: this.snapshot(room) });
        return;
      }
      changed = true;
    }

    if (now >= room.lastActivity + ROOM_IDLE_MS) {
      for (const ws of this.ctx.getWebSockets()) ws.close(1001, 'room idle');
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }

    if (changed) {
      await this.save(room);
      this.broadcast({ t: 'state', snapshot: this.snapshot(room) });
      if (room.phase === 'over') this.broadcast({ t: 'over', snapshot: this.snapshot(room) });
    } else {
      await this.scheduleAlarm(room);
    }
  }

  // ------------------------------------------------------------------ helpers

  /** The other seat if someone is sitting in it, otherwise stay put. */
  private nextSeat(room: Room, from: Seat): Seat {
    const other = (from === 0 ? 1 : 0) as Seat;
    return room.seats[other] ? other : from;
  }

  private snapshot(room: Room): RoomSnapshot {
    return {
      code: room.code,
      phase: room.phase,
      game: room.game,
      turn: room.turn,
      players: room.seats.map((s) =>
        s
          ? {
              name: s.name,
              connected: s.connected,
              ready: s.ready,
              placements: s.placements,
              cellsPlaced: s.cellsPlaced,
              linesCleared: s.linesCleared,
            }
          : null,
      ),
      deadline: room.pausedAt === null ? room.deadline : null,
      serverNow: Date.now(),
      version: room.version,
    };
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // The socket closed between the broadcast starting and this send.
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(payload);
      } catch {
        // Same as above — a dead socket must not stop the others being told.
      }
    }
  }
}
