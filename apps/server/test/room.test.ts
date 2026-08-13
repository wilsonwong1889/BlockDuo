import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyMove,
  decodeState,
  encodeState,
  getPiece,
  legalAnchors,
  type RoomSnapshot,
  type ServerMessage,
} from '@blokduo/engine';

const ORIGIN = 'https://blokduo.test';

async function createRoom(): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/room`, { method: 'POST' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { code: string };
  return body.code;
}

/** A connected player, with a queue of everything the server has sent them. */
class TestClient {
  readonly inbox: ServerMessage[] = [];
  seat: 0 | 1 | null = null;
  private ws!: WebSocket;
  /** Persistent read position: each waitFor consumes forward, like a queue. */
  private cursor = 0;

  static async connect(code: string, clientId: string, name = clientId) {
    const client = new TestClient();
    const res = await SELF.fetch(
      `${ORIGIN}/api/room/${code}/ws?clientId=${clientId}&name=${name}`,
      { headers: { Upgrade: 'websocket' } },
    );
    if (res.status !== 101) throw new Error(`connect failed: ${res.status}`);
    client.ws = res.webSocket!;
    client.ws.accept();
    client.ws.addEventListener('message', (e) => {
      client.inbox.push(JSON.parse(e.data as string) as ServerMessage);
    });
    await client.waitFor('welcome');
    return client;
  }

  static async tryConnect(code: string, clientId: string) {
    return SELF.fetch(`${ORIGIN}/api/room/${code}/ws?clientId=${clientId}`, {
      headers: { Upgrade: 'websocket' },
    });
  }

  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(text: string) {
    this.ws.send(text);
  }

  close() {
    this.ws.close(1000, 'test done');
  }

  /** Wait for the next message of a type, ignoring anything already seen. */
  async waitFor<T extends ServerMessage['t']>(
    type: T,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const start = Date.now();
    for (;;) {
      while (this.cursor < this.inbox.length) {
        const msg = this.inbox[this.cursor++];
        if (msg.t === type) {
          if (type === 'welcome' && 'seat' in msg) this.seat = msg.seat as 0 | 1;
          return msg as Extract<ServerMessage, { t: T }>;
        }
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timed out waiting for "${type}"; saw ${this.inbox.map((m) => m.t).join(', ')}`);
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  latestSnapshot(): RoomSnapshot | null {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      const msg = this.inbox[i];
      if ('snapshot' in msg) return msg.snapshot;
    }
    return null;
  }
}

/** Find a legal move for whichever slot has one, from a snapshot. */
function legalMove(snapshot: RoomSnapshot) {
  const state = decodeState(snapshot.game);
  for (let slot = 0; slot < state.hand.length; slot++) {
    const held = state.hand[slot];
    if (!held) continue;
    const anchors = legalAnchors(state.board, getPiece(held.pieceId));
    if (anchors.length) return { slot, row: anchors[0][0], col: anchors[0][1] };
  }
  throw new Error('no legal move available');
}

describe('room creation', () => {
  it('mints a valid six-character code', async () => {
    const code = await createRoom();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it('reports status for a real room and 400s a malformed code', async () => {
    const code = await createRoom();
    const ok = await SELF.fetch(`${ORIGIN}/api/room/${code}`);
    expect(await ok.json()).toMatchObject({ exists: true, open: true, players: 0 });

    const bad = await SELF.fetch(`${ORIGIN}/api/room/OOOOOO`);
    expect(bad.status).toBe(400);
  });

  it('404s an unknown but well-formed code', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/room/ABCDEF/ws`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(404);
  });
});

describe('seating', () => {
  it('seats two players and starts the game', async () => {
    const code = await createRoom();
    const a = await TestClient.connect(code, 'a');
    expect(a.seat).toBe(0);
    expect(a.latestSnapshot()?.phase).toBe('waiting');

    const b = await TestClient.connect(code, 'b');
    expect(b.seat).toBe(1);

    const snap = b.latestSnapshot()!;
    expect(snap.phase).toBe('playing');
    expect(snap.players.filter(Boolean)).toHaveLength(2);
    expect(snap.deadline).toBeGreaterThan(Date.now() - 1000);

    a.close();
    b.close();
  });

  it('turns away a third player', async () => {
    const code = await createRoom();
    const a = await TestClient.connect(code, 'a');
    const b = await TestClient.connect(code, 'b');

    const res = await TestClient.tryConnect(code, 'c');
    expect(res.status).toBe(409);

    a.close();
    b.close();
  });

  it('stays connected when a new socket lands before the old one closes', async () => {
    // A quick reconnect — and React StrictMode's double-mount in development —
    // opens the replacement socket before the old socket's close is delivered.
    // The late close must not mark a seat away that is demonstrably present.
    const code = await createRoom();
    const first = await TestClient.connect(code, 'a', 'Wilson');
    const second = await TestClient.connect(code, 'a', 'Wilson');
    expect(second.seat).toBe(0);

    await new Promise((r) => setTimeout(r, 150));

    second.send({ t: 'ping' });
    await second.waitFor('pong');
    const status = await SELF.fetch(`${ORIGIN}/api/room/${code}`);
    expect(await status.json()).toMatchObject({ players: 1 });

    // Ask for a fresh snapshot by having a partner join, then check seat 0.
    const b = await TestClient.connect(code, 'b', 'Partner');
    expect(b.latestSnapshot()!.players[0]).toMatchObject({ name: 'Wilson', connected: true });

    void first;
    second.close();
    b.close();
  });

  it('gives a reconnecting player their own seat back', async () => {
    const code = await createRoom();
    const a = await TestClient.connect(code, 'a');
    const b = await TestClient.connect(code, 'b');
    b.close();

    const again = await TestClient.connect(code, 'b');
    expect(again.seat).toBe(1);
    expect(again.latestSnapshot()?.phase).toBe('playing');

    a.close();
    again.close();
  });
});

describe('turn taking', () => {
  it('applies a legal move and passes the turn', async () => {
    const code = await createRoom();
    const a = await TestClient.connect(code, 'a');
    const b = await TestClient.connect(code, 'b');
    const snap = b.latestSnapshot()!;
    const first = snap.turn === 0 ? a : b;
    const second = snap.turn === 0 ? b : a;
    const move = legalMove(snap);
    const expected = applyMove(decodeState(snap.game), move);
    expect(expected.ok).toBe(true);

    first.send({ t: 'place', seq: 1, ...move });
    const applied = await second.waitFor('applied');

    expect(applied.by).toBe(snap.turn);
    expect(applied.scoreDelta).toBeGreaterThan(0);
    expect(applied.snapshot.turn).not.toBe(snap.turn);
    expect(applied.snapshot.version).toBe(snap.version + 1);
    if (!expected.ok) throw new Error('expected test move to be legal');
    expect(applied.events).toEqual(expected.result.events);
    expect(applied.snapshot.game).toEqual(encodeState(expected.result.state));

    // Both players are told the same thing.
    const mirrored = await first.waitFor('applied');
    expect(mirrored.snapshot.game.board).toBe(applied.snapshot.game.board);

    a.close();
    b.close();
  });

  it('rejects a move made out of turn and leaves the board alone', async () => {
    const code = await createRoom();
    const a = await TestClient.connect(code, 'a');
    const b = await TestClient.connect(code, 'b');
    const snap = b.latestSnapshot()!;
    const wrongPlayer = snap.turn === 0 ? b : a;

    wrongPlayer.send({ t: 'place', seq: 5, ...legalMove(snap) });
    const rejected = await wrongPlayer.waitFor('rejected');

    expect(rejected.seq).toBe(5);
    expect(rejected.reason).toBe('not-your-turn');
    expect(rejected.snapshot.game.board).toBe(snap.game.board);
    expect(rejected.snapshot.version).toBe(snap.version);

    a.close();
    b.close();
  });

  it('rejects an illegal placement from the player whose turn it is', async () => {
    const code = await createRoom();
    const a = await TestClient.connect(code, 'a');
    const b = await TestClient.connect(code, 'b');
    const snap = b.latestSnapshot()!;
    const mover = snap.turn === 0 ? a : b;

    mover.send({ t: 'place', seq: 9, slot: 0, row: 99, col: 99 });
    const rejected = await mover.waitFor('rejected');
    expect(rejected.reason).toBe('out-of-bounds');

    mover.send({ t: 'place', seq: 10, slot: 7, row: 0, col: 0 });
    expect((await mover.waitFor('rejected')).reason).toBe('no-such-slot');

    a.close();
    b.close();
  });

  it('will not accept moves before the second player arrives', async () => {
    const code = await createRoom();
    const a = await TestClient.connect(code, 'a');
    a.send({ t: 'place', seq: 1, slot: 0, row: 0, col: 0 });
    expect((await a.waitFor('rejected')).reason).toBe('not-playing');
    a.close();
  });

  it('credits each player only for their own placements', async () => {
    const code = await createRoom();
    const a = await TestClient.connect(code, 'a');
    const b = await TestClient.connect(code, 'b');
    let snap = b.latestSnapshot()!;

    for (let i = 0; i < 4; i++) {
      const mover = snap.turn === 0 ? a : b;
      mover.send({ t: 'place', seq: i, ...legalMove(snap) });
      // Both players are sent every applied move, so both cursors have to be
      // advanced or the next read returns a stale snapshot.
      const [seen] = await Promise.all([a.waitFor('applied'), b.waitFor('applied')]);
      snap = seen.snapshot;
    }

    const [p0, p1] = snap.players;
    expect(p0!.placements + p1!.placements).toBe(4);
    expect(p0!.placements).toBe(2);
    expect(p1!.placements).toBe(2);
    expect(p0!.cellsPlaced).toBeGreaterThan(0);

    a.close();
    b.close();
  });
});

describe('the clock', () => {
  it('passes the turn to the partner when a player runs out of time', async () => {
    const code = await createRoom();
    const a = await TestClient.connect(code, 'a');
    const b = await TestClient.connect(code, 'b');
    const before = b.latestSnapshot()!;

    // Nobody moves. The turn should pass rather than a piece being placed for
    // them — dropping someone's piece somewhere they did not choose is worse
    // than losing the turn.
    const timeout = await a.waitFor('timeout', 5000);

    expect(timeout.seat).toBe(before.turn);
    expect(timeout.snapshot.turn).not.toBe(before.turn);
    expect(timeout.snapshot.game.board).toBe(before.game.board);
    expect(timeout.snapshot.phase).toBe('playing');

    a.close();
    b.close();
  }, 10_000);

  it('frees a seat once the reconnect grace runs out, and play continues', async () => {
    const code = await createRoom();
    const a = await TestClient.connect(code, 'a');
    const b = await TestClient.connect(code, 'b');
    b.close();

    // The remaining player keeps the game and the score; the seat opens back up
    // so the partner (or anyone with the code) can drop into it.
    let snapshot = a.latestSnapshot()!;
    const deadline = Date.now() + 6000;
    while (snapshot.players[1] !== null && Date.now() < deadline) {
      await a.waitFor('state', 5000).catch(() => undefined);
      snapshot = a.latestSnapshot()!;
      if (snapshot.players[1] === null) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(snapshot.players[1]).toBeNull();
    expect(snapshot.players[0]).not.toBeNull();
    expect(snapshot.phase).not.toBe('over');

    const status = await SELF.fetch(`${ORIGIN}/api/room/${code}`);
    expect(await status.json()).toMatchObject({ open: true, players: 1 });

    a.close();
  }, 10_000);
});

describe('miscellaneous protocol', () => {
  it('answers a ping and relays an emote', async () => {
    const code = await createRoom();
    const a = await TestClient.connect(code, 'a');
    const b = await TestClient.connect(code, 'b');

    a.send({ t: 'ping' });
    expect((await a.waitFor('pong')).serverNow).toBeGreaterThan(0);

    a.send({ t: 'emote', id: 'nice' });
    const emote = await b.waitFor('emote');
    expect(emote).toMatchObject({ by: a.seat, id: 'nice' });

    a.close();
    b.close();
  });

  it('does not fall over on malformed input', async () => {
    const code = await createRoom();
    const a = await TestClient.connect(code, 'a');

    a.sendRaw('{{{ not json');
    expect((await a.waitFor('error')).code).toBe('bad-json');

    a.send({ t: 'nonsense' });
    const errors = a.inbox.filter((m) => m.t === 'error');
    await a.waitFor('error');
    expect(errors.length).toBeGreaterThan(0);

    // Still alive and answering after both.
    a.send({ t: 'ping' });
    expect((await a.waitFor('pong')).serverNow).toBeGreaterThan(0);
    a.close();
  });
});
