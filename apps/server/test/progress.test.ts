import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  applyMove,
  coinReward,
  decodeState,
  getPiece,
  legalAnchors,
  newGame,
  type ClaimResult,
  type GameState,
  type LeaderboardView,
  type Move,
  type ProgressProfile,
  type RoomSnapshot,
  type ServerMessage,
} from '@blokduo/engine';

const ORIGIN = 'https://blokduo.test';

interface Credentials {
  clientId: string;
  token: string;
}

interface Player {
  identity: Credentials;
  profile: ProgressProfile;
}

async function post<T>(path: string, body: unknown): Promise<{ response: Response; body: T }> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: (await response.json()) as T };
}

async function createPlayer(name: string): Promise<Player> {
  const result = await post<Player>('/api/progress/player', { name });
  expect(result.response.status).toBe(200);
  return result.body;
}

async function getProfile(player: Player, name?: string): Promise<ProgressProfile> {
  const result = await post<ProgressProfile>('/api/progress/profile', {
    ...player.identity,
    ...(name === undefined ? {} : { name }),
  });
  expect(result.response.status).toBe(200);
  return result.body;
}

async function createRoom(): Promise<string> {
  const result = await post<{ code: string }>('/api/room', {});
  expect(result.response.status).toBe(200);
  return result.body.code;
}

async function roomTicket(code: string, player: Player): Promise<string> {
  const result = await post<{ ticket: string }>(`/api/room/${code}/ticket`, {
    ...player.identity,
    name: player.profile.name,
  });
  expect(result.response.status).toBe(200);
  expect(result.body.ticket).toMatch(/^[a-f0-9]{36}$/);
  return result.body.ticket;
}

class AuthenticatedDuoClient {
  private readonly inbox: ServerMessage[] = [];
  private cursor = 0;
  private ws!: WebSocket;
  seat: 0 | 1 | null = null;
  welcomeSnapshot!: RoomSnapshot;

  static async connect(code: string, ticket: string): Promise<AuthenticatedDuoClient> {
    const client = new AuthenticatedDuoClient();
    const response = await SELF.fetch(
      `${ORIGIN}/api/room/${code}/ws?ticket=${encodeURIComponent(ticket)}`,
      { headers: { Upgrade: 'websocket' } },
    );
    if (response.status !== 101) throw new Error(`Duo connection failed: ${response.status}`);

    client.ws = response.webSocket!;
    client.ws.accept();
    client.ws.addEventListener('message', (event) => {
      client.inbox.push(JSON.parse(event.data as string) as ServerMessage);
    });
    const welcome = await client.waitFor('welcome');
    client.seat = welcome.seat;
    client.welcomeSnapshot = welcome.snapshot;
    return client;
  }

  send(message: unknown) {
    this.ws.send(JSON.stringify(message));
  }

  close() {
    this.ws.close(1000, 'test complete');
  }

  async waitFor<T extends ServerMessage['t']>(
    type: T,
    timeoutMs = 2_000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const startedAt = Date.now();
    for (;;) {
      while (this.cursor < this.inbox.length) {
        const message = this.inbox[this.cursor++];
        if (message.t === type) return message as Extract<ServerMessage, { t: T }>;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Timed out waiting for ${type}; received ${this.inbox.map((message) => message.t).join(', ')}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
}

/**
 * Play a real deterministic game until the engine itself declares game over.
 * The intentionally simple top-left strategy also makes the transcript stable
 * and keeps the API test independent of hand-authored engine internals.
 */
function completedClassic(seed = 0x5eedc0de): { state: GameState; moves: Move[] } {
  let state = newGame(seed);
  const moves: Move[] = [];

  while (!state.over && moves.length < 2_000) {
    let move: Move | null = null;
    for (let slot = 0; slot < state.hand.length && !move; slot++) {
      const held = state.hand[slot];
      if (!held) continue;
      const anchor = legalAnchors(state.board, getPiece(held.pieceId))[0];
      if (anchor) move = { slot, row: anchor[0], col: anchor[1] };
    }
    if (!move) throw new Error('Engine reported a live game with no legal move');

    const applied = applyMove(state, move);
    if (!applied.ok) throw new Error(`Generated an illegal move: ${applied.reason}`);
    moves.push(move);
    state = applied.result.state;
  }

  if (!state.over) throw new Error('Deterministic game did not finish within 2,000 moves');
  return { state, moves };
}

describe('progress player identity', () => {
  it('creates an authenticated player and rejects missing or invalid credentials', async () => {
    const marker = crypto.randomUUID().slice(0, 8);
    const player = await createPlayer(`Player ${marker}`);

    expect(player.identity.clientId).toMatch(/^p_[a-f0-9]{32}$/);
    expect(player.identity.token).toMatch(/^[a-f0-9]{64}$/);
    expect(player.profile).toMatchObject({
      clientId: player.identity.clientId,
      name: `Player ${marker}`,
      coins: 0,
      gamesPlayed: 0,
      friends: [],
    });
    expect(player.profile.friendCode).toMatch(/^BD-[A-HJ-NP-Z2-9]{8}$/);

    const missing = await post<{ error: string }>('/api/progress/profile', {});
    expect(missing.response.status).toBe(401);

    const forged = await post<{ error: string }>('/api/progress/profile', {
      clientId: player.identity.clientId,
      token: `${player.identity.token.slice(0, -1)}${player.identity.token.endsWith('0') ? '1' : '0'}`,
    });
    expect(forged.response.status).toBe(401);
    expect(forged.body.error).toMatch(/session/i);
  });

  it('updates and sanitises the authenticated player name', async () => {
    const player = await createPlayer('Before');
    const updated = await getProfile(player, '  After\nName  ');

    expect(updated.name).toBe('AfterName');
    expect((await getProfile(player)).name).toBe('AfterName');
  });
});

describe('progress friendships', () => {
  it('adds and removes a friendship mutually', async () => {
    const marker = crypto.randomUUID().slice(0, 8);
    const alice = await createPlayer(`Alice ${marker}`);
    const bob = await createPlayer(`Bob ${marker}`);

    const added = await post<ProgressProfile>('/api/progress/friends/add', {
      ...alice.identity,
      friendCode: bob.profile.friendCode.toLowerCase(),
    });
    expect(added.response.status).toBe(200);
    expect(added.body.friends).toEqual([
      { friendCode: bob.profile.friendCode, name: bob.profile.name },
    ]);

    expect((await getProfile(bob)).friends).toEqual([
      { friendCode: alice.profile.friendCode, name: alice.profile.name },
    ]);

    const removed = await post<ProgressProfile>('/api/progress/friends/remove', {
      ...bob.identity,
      friendCode: alice.profile.friendCode,
    });
    expect(removed.response.status).toBe(200);
    expect(removed.body.friends).toEqual([]);
    expect((await getProfile(alice)).friends).toEqual([]);
  });

  it('rejects malformed, unknown, and self friend codes', async () => {
    const player = await createPlayer('Solo');

    const malformed = await post<{ error: string }>('/api/progress/friends/add', {
      ...player.identity,
      friendCode: 'not-a-code',
    });
    expect(malformed.response.status).toBe(400);
    expect(malformed.body.error).toMatch(/friend codes/i);

    const unknown = await post<{ error: string }>('/api/progress/friends/add', {
      ...player.identity,
      friendCode: 'BD-AAAAAAAA',
    });
    expect(unknown.response.status).toBe(404);

    const self = await post<{ error: string }>('/api/progress/friends/add', {
      ...player.identity,
      friendCode: player.profile.friendCode,
    });
    expect(self.response.status).toBe(400);
    expect(self.body.error).toMatch(/own friend code/i);
  });

  it('limits the friends board to the player and current friends', async () => {
    const marker = crypto.randomUUID().slice(0, 8);
    const alice = await createPlayer(`Board Alice ${marker}`);
    const bob = await createPlayer(`Board Bob ${marker}`);
    const outsider = await createPlayer(`Board Outsider ${marker}`);
    const game = completedClassic();

    await post('/api/progress/friends/add', {
      ...alice.identity,
      friendCode: bob.profile.friendCode,
    });
    for (const player of [alice, bob, outsider]) {
      const claim = await post<ClaimResult>('/api/progress/classic', {
        ...player.identity,
        seed: game.state.seed,
        moves: game.moves,
      });
      expect(claim.response.status).toBe(200);
      expect(claim.body.awarded).toBe(true);
    }

    const board = await post<LeaderboardView>('/api/progress/leaderboard', {
      ...alice.identity,
      mode: 'classic',
      scope: 'friends',
    });
    expect(board.response.status).toBe(200);
    expect(board.body.scope).toBe('friends');
    expect(board.body.week.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(board.body.entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([alice.profile.name, bob.profile.name]),
    );
    expect(board.body.entries.map((entry) => entry.name)).not.toContain(outsider.profile.name);
    expect(board.body.entries).toHaveLength(2);
    expect(board.body.entries.find((entry) => entry.name === alice.profile.name)?.isYou).toBe(true);
    expect(board.body.entries.find((entry) => entry.name === bob.profile.name)?.isFriend).toBe(true);

    await post('/api/progress/friends/remove', {
      ...alice.identity,
      friendCode: bob.profile.friendCode,
    });
    const afterRemoval = await post<LeaderboardView>('/api/progress/leaderboard', {
      ...alice.identity,
      mode: 'classic',
      scope: 'friends',
    });
    expect(afterRemoval.body.entries.map((entry) => entry.name)).toEqual([alice.profile.name]);
  });
});

describe('classic progression claims', () => {
  it('replays the transcript, awards computed coins, and is idempotent', async () => {
    const player = await createPlayer('Classic claimant');
    const game = completedClassic();
    const expectedReward = coinReward(game.state.score, game.state.moveCount);

    const [first, racingDuplicate] = await Promise.all([
      post<ClaimResult>('/api/progress/classic', {
        ...player.identity,
        seed: game.state.seed,
        moves: game.moves,
        // Deliberately bogus client values: the authority must ignore these and replay.
        score: 999_999_999,
        moveCount: 999_999,
      }),
      post<ClaimResult>('/api/progress/classic', {
        ...player.identity,
        seed: game.state.seed,
        moves: game.moves,
      }),
    ]);
    expect(first.response.status).toBe(200);
    expect(racingDuplicate.response.status).toBe(200);
    expect([first.body.awarded, racingDuplicate.body.awarded].sort()).toEqual([false, true]);
    expect(first.body.reward).toEqual(expectedReward);
    expect(racingDuplicate.body.reward).toEqual(expectedReward);
    expect(await getProfile(player)).toMatchObject({
      coins: expectedReward.totalCoins,
      gamesPlayed: 1,
    });

    const duplicate = await post<ClaimResult>('/api/progress/classic', {
      ...player.identity,
      seed: game.state.seed,
      moves: game.moves,
    });
    expect(duplicate.response.status).toBe(200);
    expect(duplicate.body).toMatchObject({
      awarded: false,
      reward: expectedReward,
      profile: { coins: expectedReward.totalCoins, gamesPlayed: 1 },
    });
  });

  it('rejects nonterminal and illegal transcripts without changing progression', async () => {
    const player = await createPlayer('Rejected claimant');
    const game = completedClassic();

    const nonterminal = await post<{ error: string }>('/api/progress/classic', {
      ...player.identity,
      seed: game.state.seed,
      moves: [],
    });
    expect(nonterminal.response.status).toBe(400);
    expect(nonterminal.body.error).toMatch(/completed games/i);

    const illegal = await post<{ error: string }>('/api/progress/classic', {
      ...player.identity,
      seed: game.state.seed,
      moves: [...game.moves, game.moves[0]],
    });
    expect(illegal.response.status).toBe(400);
    expect(illegal.body.error).toMatch(/illegal move/i);

    expect(await getProfile(player)).toMatchObject({ coins: 0, gamesPlayed: 0 });
  });
});

describe('Duo progression settlement', () => {
  it('settles one natural authenticated round for both players and one pair entry', async () => {
    const marker = crypto.randomUUID().slice(0, 8);
    const alice = await createPlayer(`Duo Alice ${marker}`);
    const bob = await createPlayer(`Duo Bob ${marker}`);
    const code = await createRoom();
    const aliceTicket = await roomTicket(code, alice);
    const bobTicket = await roomTicket(code, bob);
    let aliceClient: AuthenticatedDuoClient | null = null;
    let bobClient: AuthenticatedDuoClient | null = null;
    let finalSnapshot: RoomSnapshot | null = null;

    try {
      aliceClient = await AuthenticatedDuoClient.connect(code, aliceTicket);
      bobClient = await AuthenticatedDuoClient.connect(code, bobTicket);
      expect(aliceClient.seat).not.toBe(bobClient.seat);

      // Bob joined second, so his welcome contains the authoritative started state.
      let snapshot = bobClient.welcomeSnapshot;
      expect(snapshot.phase).toBe('playing');

      const clients = [aliceClient, bobClient] as const;
      const seats = new Map(clients.map((client) => [client.seat, client]));
      let seq = 1;

      while (snapshot.phase === 'playing' && snapshot.version < 2_000) {
        const state = decodeState(snapshot.game);
        let move: Move | null = null;
        for (let slot = 0; slot < state.hand.length && !move; slot++) {
          const held = state.hand[slot];
          if (!held) continue;
          const anchor = legalAnchors(state.board, getPiece(held.pieceId))[0];
          if (anchor) move = { slot, row: anchor[0], col: anchor[1] };
        }
        if (!move) throw new Error('Live Duo snapshot had no legal placement');

        const actor = seats.get(snapshot.turn);
        if (!actor) throw new Error(`No client owns seat ${snapshot.turn}`);
        actor.send({ t: 'place', seq: seq++, ...move });

        // Alice is the single ordered observer. Waiting on whichever player
        // moved would leave the partner's previous applied message queued.
        const applied = await aliceClient.waitFor('applied');
        expect(applied.snapshot.version).toBe(snapshot.version + 1);
        snapshot = applied.snapshot;
      }

      if (snapshot.phase !== 'over') throw new Error('Duo game did not naturally finish');
      finalSnapshot = snapshot;

      const [aliceOver, bobOver] = await Promise.all([
        aliceClient.waitFor('over'),
        bobClient.waitFor('over'),
      ]);
      expect(aliceOver.snapshot.result).toEqual(bobOver.snapshot.result);
    } finally {
      aliceClient?.close();
      bobClient?.close();
    }

    if (!finalSnapshot) throw new Error('Missing final Duo snapshot');
    const finalState = decodeState(finalSnapshot.game);
    const expectedReward = coinReward(finalState.score, finalState.moveCount);
    expect(finalState.over).toBe(true);
    expect(finalSnapshot.result).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{32}:1$/),
      kind: 'completed',
      reward: expectedReward,
      settled: true,
    });

    const aliceAfter = await getProfile(alice);
    const bobAfter = await getProfile(bob);
    expect(aliceAfter).toMatchObject({ coins: expectedReward.totalCoins, gamesPlayed: 1 });
    expect(bobAfter).toMatchObject({ coins: expectedReward.totalCoins, gamesPlayed: 1 });
    // Re-reading after both over broadcasts proves the durable, idempotent
    // settlement did not pay either wallet once per connected client.
    expect(await getProfile(alice)).toMatchObject({
      coins: expectedReward.totalCoins,
      gamesPlayed: 1,
    });
    expect(await getProfile(bob)).toMatchObject({
      coins: expectedReward.totalCoins,
      gamesPlayed: 1,
    });

    const leaderboard = await post<LeaderboardView>('/api/progress/leaderboard', {
      ...alice.identity,
      mode: 'duo',
      scope: 'global',
    });
    expect(leaderboard.response.status).toBe(200);
    const pairEntries = leaderboard.body.entries.filter(
      (entry) => entry.name.includes(alice.profile.name) && entry.name.includes(bob.profile.name),
    );
    expect(pairEntries).toHaveLength(1);
    expect(pairEntries[0]).toMatchObject({
      score: finalState.score,
      moveCount: finalState.moveCount,
      mode: 'duo',
      isYou: true,
    });
  }, 10_000);
});
