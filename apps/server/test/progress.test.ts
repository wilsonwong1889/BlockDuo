import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  applyMove,
  coinReward,
  decodeState,
  applyAction,
  gameSeed,
  getPiece,
  newSession,
  POWER_COSTS,
  MAX_AD_SPINS_PER_DAY,
  WHEEL_COST_COINS,
  WHEEL_SEGMENTS,
  legalAnchors,
  newGame,
  type ClaimResult,
  type DuoMode,
  type GameState,
  type LeaderboardView,
  type Move,
  type GameAction,
  type ProgressProfile,
  type PublicProfile,
  type WheelResult,
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

async function createRoom(mode: DuoMode = 'ranked'): Promise<string> {
  const result = await post<{ code: string }>('/api/room', { mode });
  expect(result.response.status).toBe(200);
  return result.body.code;
}

/**
 * Two authenticated players take a room all the way to a natural finish, and
 * the final snapshot comes back. Both mode tests need the same round; only what
 * the ledger did with it afterwards differs.
 */
async function playDuoRoundOut(
  code: string,
  alice: Player,
  bob: Player,
): Promise<RoomSnapshot> {
  const aliceTicket = await roomTicket(code, alice);
  const bobTicket = await roomTicket(code, bob);
  let aliceClient: AuthenticatedDuoClient | null = null;
  let bobClient: AuthenticatedDuoClient | null = null;

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

    const [aliceOver, bobOver] = await Promise.all([
      aliceClient.waitFor('over'),
      bobClient.waitFor('over'),
    ]);
    expect(aliceOver.snapshot.result).toEqual(bobOver.snapshot.result);
    return snapshot;
  } finally {
    aliceClient?.close();
    bobClient?.close();
  }
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

/**
 * A finished game whose transcript contains powers, so the claim path is
 * exercised on exactly what a player using them would send.
 */
function completedWithPowers(seed: number): { state: GameState; actions: GameAction[] } {
  let session = newSession(seed);
  const actions: GameAction[] = [];

  const take = (action: GameAction) => {
    const result = applyAction(session, action);
    if (!result.ok) throw new Error(`rejected ${JSON.stringify(action)}: ${result.reason}`);
    session = result.session;
    actions.push(action);
  };

  const nextMove = (): Move | null => {
    const state = session.state;
    for (let slot = 0; slot < state.hand.length; slot++) {
      const held = state.hand[slot];
      if (!held) continue;
      const anchor = legalAnchors(state.board, getPiece(held.pieceId))[0];
      if (anchor) return { slot, row: anchor[0], col: anchor[1] };
    }
    return null;
  };

  let spent = false;
  while (!session.state.over && actions.length < 2_000) {
    const move = nextMove();
    if (!move) break;
    take(move);

    // Once, early on: take the placement back, then throw the hand away.
    if (!spent && session.state.moveCount >= 2) {
      spent = true;
      take({ t: 'undo' });
      take({ t: 'reroll' });
    }
  }

  if (!session.state.over) throw new Error('powered game did not finish');
  return { state: session.state, actions };
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
      ranked: true,
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
    expect(board.body.weekly.entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([alice.profile.name, bob.profile.name]),
    );
    expect(board.body.weekly.entries.map((entry) => entry.name)).not.toContain(outsider.profile.name);
    expect(board.body.weekly.entries).toHaveLength(2);
    expect(board.body.weekly.entries.find((entry) => entry.name === alice.profile.name)?.isYou).toBe(true);
    expect(board.body.weekly.entries.find((entry) => entry.name === bob.profile.name)?.isFriend).toBe(true);

    await post('/api/progress/friends/remove', {
      ...alice.identity,
      friendCode: bob.profile.friendCode,
    });
    const afterRemoval = await post<LeaderboardView>('/api/progress/leaderboard', {
      ...alice.identity,
      mode: 'classic',
      scope: 'friends',
    });
    expect(afterRemoval.body.weekly.entries.map((entry) => entry.name)).toEqual([alice.profile.name]);
  });

  it('lifts scores recorded before the all-time board existed onto it', async () => {
    const player = await createPlayer(`Historic ${crypto.randomUUID().slice(0, 8)}`);
    const game = completedClassic(gameSeed(0x0a11717));
    await post<ClaimResult>('/api/progress/classic', {
      ...player.identity,
      seed: game.state.seed,
      moves: game.moves,
      ranked: true,
    });

    // Exactly the state a ledger with history was left in: weekly records
    // written by an older build, an all-time window that never existed, and no
    // migration marker. The score has to reappear without being replayed.
    const stub = env.PROGRESS.get(env.PROGRESS.idFromName('global'));
    const removed = await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.delete('migration:alltime:v1');
      const allTime = [...(await state.storage.list<unknown>({ prefix: 'score:alltime:' })).keys()];
      await state.storage.delete(allTime);
      return allTime.length;
    });
    expect(removed).toBeGreaterThan(0);

    const board = await post<LeaderboardView>('/api/progress/leaderboard', {
      ...player.identity,
      mode: 'classic',
      scope: 'global',
    });

    const mine = board.body.allTime.entries.find((entry) => entry.name === player.profile.name);
    expect(mine).toMatchObject({
      score: game.state.score,
      moveCount: game.state.moveCount,
    });
    // All time can never be missing something this week has: it is every week.
    for (const weekEntry of board.body.weekly.entries) {
      expect(board.body.allTime.entries.some((entry) => entry.name === weekEntry.name)).toBe(true);
    }
  });

  it('publishes a profile anyone can read, with server-counted totals', async () => {
    const player = await createPlayer(`Public ${crypto.randomUUID().slice(0, 8)}`);
    const game = completedClassic(gameSeed(0x0bacc11));
    await post<ClaimResult>('/api/progress/classic', {
      ...player.identity,
      seed: game.state.seed,
      moves: game.moves,
      ranked: true,
    });

    // No credentials: this is the whole point of a public profile.
    const response = await SELF.fetch(
      `${ORIGIN}/api/progress/player/${player.profile.friendCode}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as PublicProfile;

    expect(body).toMatchObject({
      friendCode: player.profile.friendCode,
      name: player.profile.name,
    });
    expect(body.stats).toMatchObject({
      gamesPlayed: 1,
      classicGames: 1,
      duoGames: 0,
      bestScore: game.state.score,
      totalScore: game.state.score,
      totalLines: game.state.linesCleared,
      bestStreak: game.state.bestStreak,
    });
    expect(body.stats.lastPlayedAt).toBeGreaterThan(body.joinedAt - 1);
    expect(body.stats.lastPlayedAt).toBeLessThanOrEqual(Date.now());
    // Nothing that could be used to act as this player may appear here.
    expect(JSON.stringify(body)).not.toContain(player.identity.clientId);
    expect(JSON.stringify(body)).not.toContain(player.identity.token);
  });

  it('recovers a best score earned before profiles counted anything', async () => {
    const player = await createPlayer(`Veteran ${crypto.randomUUID().slice(0, 8)}`);
    const game = completedClassic(gameSeed(0x0e7e5a2));
    await post<ClaimResult>('/api/progress/classic', {
      ...player.identity,
      seed: game.state.seed,
      moves: game.moves,
      ranked: true,
    });

    // What an older build left behind: a score on the board, a profile with no
    // totals on it, and no migration marker.
    const stub = env.PROGRESS.get(env.PROGRESS.idFromName('global'));
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.delete('migration:stats:v1');
      const key = `profile:${player.identity.clientId}`;
      const stored = await state.storage.get<Record<string, unknown>>(key);
      delete stored!.bestScore;
      delete stored!.totalScore;
      await state.storage.put(key, stored);
    });

    const response = await SELF.fetch(
      `${ORIGIN}/api/progress/player/${player.profile.friendCode}`,
    );
    const body = (await response.json()) as PublicProfile;
    expect(body.stats.bestScore).toBe(game.state.score);
  });

  it('claims a game that used powers, and rejects a forged one', async () => {
    const player = await createPlayer(`Powered ${crypto.randomUUID().slice(0, 8)}`);
    const { state, actions } = completedWithPowers(gameSeed(0x0b0ec12));

    // The transcript contains an undo and a reroll, and still verifies.
    expect(actions.some((a) => 't' in a && a.t === 'undo')).toBe(true);
    expect(actions.some((a) => 't' in a && a.t === 'reroll')).toBe(true);

    const claim = await post<ClaimResult>('/api/progress/classic', {
      ...player.identity,
      seed: state.seed,
      moves: actions,
    });
    expect(claim.response.status).toBe(200);
    expect(claim.body.reward).toEqual(coinReward(state.score, state.moveCount));

    // A fourth undo is beyond the limit, so the replay refuses the whole game.
    const forged = await post<{ error: string }>('/api/progress/classic', {
      ...player.identity,
      seed: state.seed,
      moves: [...actions, { t: 'undo' }, { t: 'undo' }, { t: 'undo' }, { t: 'undo' }],
    });
    expect(forged.response.status).toBe(400);
  });

  it('gives one free spin a day, then charges, then frees up again tomorrow', async () => {
    const player = await createPlayer(`Daily ${crypto.randomUUID().slice(0, 8)}`);
    expect(player.profile.freeSpinAvailable).toBe(true);

    // First spin of the day is free even with nothing in the wallet.
    const first = await post<WheelResult>('/api/progress/wheel', { ...player.identity });
    expect(first.response.status).toBe(200);
    expect(first.body.free).toBe(true);
    expect(first.body.profile.coins).toBe(0);
    expect(first.body.profile.freeSpinAvailable).toBe(false);
    expect(first.body.profile.gems).toBe(first.body.gems);

    // The second one wants coins, and there are none.
    const second = await post<{ error: string }>('/api/progress/wheel', { ...player.identity });
    expect(second.response.status).toBe(400);

    // Roll the stamp back a day: tomorrow's spin is free again.
    const stub = env.PROGRESS.get(env.PROGRESS.idFromName('global'));
    await runInDurableObject(stub, async (_i, state) => {
      const key = `profile:${player.identity.clientId}`;
      const stored = await state.storage.get<Record<string, unknown>>(key);
      await state.storage.put(key, { ...stored, freeSpinDay: '2020-01-01' });
    });

    expect((await getProfile(player)).freeSpinAvailable).toBe(true);
    const tomorrow = await post<WheelResult>('/api/progress/wheel', { ...player.identity });
    expect(tomorrow.body.free).toBe(true);
  });

  it('sells three spins a day for adverts, then stops', async () => {
    const player = await createPlayer(`Viewer ${crypto.randomUUID().slice(0, 8)}`);

    // Free spin first: an advert is never asked for while one is waiting.
    const free = await post<WheelResult>('/api/progress/wheel', {
      ...player.identity,
      watchedAd: true,
    });
    expect(free.body.source).toBe('free');

    for (let i = 1; i <= MAX_AD_SPINS_PER_DAY; i++) {
      const spin = await post<WheelResult>('/api/progress/wheel', {
        ...player.identity,
        watchedAd: true,
      });
      expect(spin.body.source).toBe('ad');
      expect(spin.body.profile.adSpinsLeft).toBe(MAX_AD_SPINS_PER_DAY - i);
      expect(spin.body.profile.coins).toBe(0);
    }

    // Allowance gone, wallet empty: watching another changes nothing.
    const over = await post<{ error: string }>('/api/progress/wheel', {
      ...player.identity,
      watchedAd: true,
    });
    expect(over.response.status).toBe(400);

    // Tomorrow the allowance is whole again.
    const stub = env.PROGRESS.get(env.PROGRESS.idFromName('global'));
    await runInDurableObject(stub, async (_i, state) => {
      const key = `profile:${player.identity.clientId}`;
      const stored = await state.storage.get<Record<string, unknown>>(key);
      await state.storage.put(key, { ...stored, adSpinDay: '2020-01-01', freeSpinDay: '2020-01-01' });
    });
    expect((await getProfile(player)).adSpinsLeft).toBe(MAX_AD_SPINS_PER_DAY);
  });

  it('keeps a casual Classic game off the boards but still pays it', async () => {
    const marker = crypto.randomUUID().slice(0, 8);
    const player = await createPlayer(`Casual ${marker}`);
    const game = completedClassic(gameSeed(0x0ca50a1));

    const claim = await post<ClaimResult>('/api/progress/classic', {
      ...player.identity,
      seed: game.state.seed,
      moves: game.moves,
      // No `ranked`, so this is the everyday game.
    });
    expect(claim.response.status).toBe(200);
    expect(claim.body.reward.totalCoins).toBeGreaterThan(0);
    expect((await getProfile(player)).coins).toBe(claim.body.reward.totalCoins);

    const board = await post<LeaderboardView>('/api/progress/leaderboard', {
      ...player.identity,
      mode: 'classic',
      scope: 'global',
    });
    for (const half of [board.body.weekly, board.body.allTime]) {
      expect(half.entries.filter((entry) => entry.name.includes(marker))).toHaveLength(0);
    }
  });

  it('refuses a ranked claim for a game that used powers', async () => {
    const player = await createPlayer(`Cheat ${crypto.randomUUID().slice(0, 8)}`);
    const { state, actions } = completedWithPowers(gameSeed(0x0c4ea7));

    // The same game claims fine as casual and is refused as ranked, which is
    // the whole difference between the two modes.
    const casual = await post<ClaimResult>('/api/progress/classic', {
      ...player.identity,
      seed: state.seed,
      moves: actions,
    });
    expect(casual.response.status).toBe(200);

    const ranked = await post<{ error: string }>('/api/progress/classic', {
      ...player.identity,
      seed: state.seed,
      moves: actions,
      ranked: true,
    });
    expect(ranked.response.status).toBe(400);
    expect(ranked.body.error).toMatch(/ranked/i);
  });

  it('refuses a transcript containing a power that no longer exists', async () => {
    const player = await createPlayer(`Ghost ${crypto.randomUUID().slice(0, 8)}`);
    const game = completedClassic(gameSeed(0x0e0571));

    // Revive was removed along with the adverts that paid for it. A crafted
    // transcript must not be able to bring it back and claim the score.
    const forged = await post<{ error: string }>('/api/progress/classic', {
      ...player.identity,
      seed: game.state.seed,
      moves: [...game.moves, { t: 'revive' }],
    });
    expect(forged.response.status).toBe(400);
    expect((await getProfile(player)).gamesPlayed).toBe(0);
  });

  it('turns coins into gems on the wheel, and refuses a spin nobody can afford', async () => {
    const player = await createPlayer(`Spinner ${crypto.randomUUID().slice(0, 8)}`);

    // Take the free spin and the advert allowance out of the way; this test is
    // about the coin-paid spin.
    await post<WheelResult>('/api/progress/wheel', { ...player.identity });
    for (let i = 0; i < MAX_AD_SPINS_PER_DAY; i++) {
      await post<WheelResult>('/api/progress/wheel', { ...player.identity, watchedAd: true });
    }

    const broke = await post<{ error: string }>('/api/progress/wheel', { ...player.identity });
    expect(broke.response.status).toBe(400);

    // Granted directly: earning 10,000 coins would mean playing a dozen games.
    const stub = env.PROGRESS.get(env.PROGRESS.idFromName('global'));
    await runInDurableObject(stub, async (_i, state) => {
      const key = `profile:${player.identity.clientId}`;
      const stored = await state.storage.get<Record<string, unknown>>(key);
      await state.storage.put(key, { ...stored, coins: WHEEL_COST_COINS + 25 });
    });

    const spin = await post<WheelResult>('/api/progress/wheel', { ...player.identity });
    expect(spin.response.status).toBe(200);
    expect(spin.body.free).toBe(false);
    expect(spin.body.source).toBe('coins');
    expect(WHEEL_SEGMENTS.map((s) => s.gems)).toContain(spin.body.gems);
    expect(spin.body.profile.coins).toBe(25);
  });

  it('charges the listed price for a power and refuses what cannot be paid', async () => {
    const player = await createPlayer(`Spender ${crypto.randomUUID().slice(0, 8)}`);
    const stub = env.PROGRESS.get(env.PROGRESS.idFromName('global'));
    await runInDurableObject(stub, async (_i, state) => {
      const key = `profile:${player.identity.clientId}`;
      const stored = await state.storage.get<Record<string, unknown>>(key);
      await state.storage.put(key, { ...stored, gems: 3 });
    });

    const undo = await post<ProgressProfile>('/api/progress/gems/spend', {
      ...player.identity,
      power: 'undo',
    });
    expect(undo.body.gems).toBe(3 - POWER_COSTS.undo);

    const rotate = await post<ProgressProfile>('/api/progress/gems/spend', {
      ...player.identity,
      power: 'rotate',
    });
    expect(rotate.body.gems).toBe(0);

    // Nothing left, so the next one is refused rather than going negative.
    const broke = await post<{ error: string }>('/api/progress/gems/spend', {
      ...player.identity,
      power: 'reroll',
    });
    expect(broke.response.status).toBe(400);
    expect((await getProfile(player)).gems).toBe(0);
  });

  it('refuses a power that does not exist', async () => {
    const player = await createPlayer(`Inventive ${crypto.randomUUID().slice(0, 8)}`);
    const made_up = await post<{ error: string }>('/api/progress/gems/spend', {
      ...player.identity,
      power: 'teleport',
    });
    expect(made_up.response.status).toBe(400);
  });

  it('refuses a profile for a code that does not exist', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/progress/player/BD-NOTREAL1`);
    expect(response.status).toBe(404);
  });

  it('leaves an already-migrated ledger alone', async () => {
    const player = await createPlayer(`Settled ${crypto.randomUUID().slice(0, 8)}`);
    const game = completedClassic(gameSeed(0x0577ed1));
    await post<ClaimResult>('/api/progress/classic', {
      ...player.identity,
      seed: game.state.seed,
      moves: game.moves,
    });

    const read = () =>
      post<LeaderboardView>('/api/progress/leaderboard', {
        ...player.identity,
        mode: 'classic',
        scope: 'global',
      });

    const first = await read();
    const second = await read();
    expect(second.body.allTime.entries).toEqual(first.body.allTime.entries);
  });
});

describe('limits and reports', () => {
  /** Requests carrying the header Cloudflare puts on every real request. */
  const fromAddress = (address: string, name: string) =>
    SELF.fetch(`${ORIGIN}/api/progress/player`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': address },
      body: JSON.stringify({ name }),
    });

  it('stops one address minting players without end', async () => {
    const address = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

    // Every profile is a permanent key, so the cap is what keeps a script from
    // growing storage for ever.
    let created = 0;
    for (let i = 0; i < 12; i++) {
      const response = await fromAddress(address, `Flood ${i}`);
      if (response.status === 200) created += 1;
      else {
        expect(response.status).toBe(429);
        break;
      }
    }
    expect(created).toBeGreaterThan(0);
    expect(created).toBeLessThan(12);

    // A different address is unaffected: the limit is per visitor, not global.
    const elsewhere = await fromAddress('198.51.100.7', 'Innocent bystander');
    expect(elsewhere.status).toBe(200);
  });

  it('leaves local and test traffic alone', async () => {
    // No address header at all, which is what local development looks like.
    for (let i = 0; i < 8; i++) {
      const player = await createPlayer(`Local ${i}-${crypto.randomUUID().slice(0, 6)}`);
      expect(player.profile.friendCode).toMatch(/^BD-/);
    }
  });

  it('accepts a crash report and keeps nothing', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/telemetry/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Cannot read properties of null',
        stack: 'x'.repeat(50_000),
        screen: '#/classic',
        version: '1.8.14.13',
      }),
    });
    expect(response.status).toBe(204);
  });

  it('shrugs off a crash report that is not even JSON', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/telemetry/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    });
    expect(response.status).toBe(204);
  });
});

describe('metrics', () => {
  const metrics = (token: string, days = 14) =>
    SELF.fetch(`${ORIGIN}/api/admin/metrics?token=${token}&days=${days}`);

  it('stays shut when no secret is configured', async () => {
    // The binding is not set in tests, which is the same as not set in
    // production before anyone remembers to set it.
    const open = await metrics('anything');
    expect(open.status).toBe(404);
    const empty = await metrics('');
    expect(empty.status).toBe(404);
  });

  it('counts what the server did, not what a client claimed', async () => {
    const stub = env.PROGRESS.get(env.PROGRESS.idFromName('global'));

    const before = await runInDurableObject(stub, (instance) => instance.metrics(2));
    const today = new Date().toISOString().slice(0, 10);
    const countFor = (rows: Array<Record<string, number | string>>, name: string) =>
      Number(rows.find((row) => row.day === today)?.[name] ?? 0);
    if (!before.ok) throw new Error('metrics unavailable');
    const playersBefore = countFor(before.value, 'player.created');

    await createPlayer(`Counted ${crypto.randomUUID().slice(0, 8)}`);

    const after = await runInDurableObject(stub, (instance) => instance.metrics(2));
    if (!after.ok) throw new Error('metrics unavailable');
    expect(countFor(after.value, 'player.created')).toBe(playersBefore + 1);
    // A day, a name and a number — nothing that identifies anybody.
    const row = after.value.find((entry) => entry.day === today)!;
    expect(Object.keys(row).every((key) => key === 'day' || /^[a-z.]+$/.test(key))).toBe(true);
  });
});

describe('display names', () => {
  it('refuses a name nobody should have to see, and keeps the old one', async () => {
    const player = await createPlayer(`Polite ${crypto.randomUUID().slice(0, 8)}`);

    const refused = await post<{ error: string }>('/api/progress/profile', {
      ...player.identity,
      name: 'f4ggot',
    });
    expect(refused.response.status).toBe(400);
    expect((await getProfile(player)).name).toBe(player.profile.name);
  });

  it('does not refuse an innocent name that contains a rude substring', async () => {
    const player = await createPlayer(`Placeholder ${crypto.randomUUID().slice(0, 8)}`);
    const renamed = await getProfile(player, 'Scunthorpe');
    expect(renamed.name).toBe('Scunthorpe');
  });

  it('never lets a created player carry a banned name', async () => {
    const player = await createPlayer('n1gger');
    expect(player.profile.name).toBe('Player');
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

  it('accepts and verifies transcripts using the assisted opening rules', async () => {
    const player = await createPlayer('Assisted claimant');
    const game = completedClassic(gameSeed(0x0a55157));
    const claim = await post<ClaimResult>('/api/progress/classic', {
      ...player.identity,
      seed: game.state.seed,
      moves: game.moves,
    });

    expect(claim.response.status).toBe(200);
    expect(claim.body.reward).toEqual(coinReward(game.state.score, game.state.moveCount));
  });
});

describe('Duo progression settlement', () => {
  it('settles one natural authenticated round for both players and one pair entry', async () => {
    const marker = crypto.randomUUID().slice(0, 8);
    const alice = await createPlayer(`Duo Alice ${marker}`);
    const bob = await createPlayer(`Duo Bob ${marker}`);
    const code = await createRoom('ranked');
    const finalSnapshot = await playDuoRoundOut(code, alice, bob);
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

    // The same result is filed under this week and under all time, so it keeps
    // its place on the permanent board once the week has rolled over.
    const ourPair = (board: { entries: LeaderboardView['weekly']['entries'] }) =>
      board.entries.filter(
        (entry) => entry.name.includes(alice.profile.name) && entry.name.includes(bob.profile.name),
      );

    for (const board of [leaderboard.body.weekly, leaderboard.body.allTime]) {
      const pairEntries = ourPair(board);
      expect(pairEntries).toHaveLength(1);
      expect(pairEntries[0]).toMatchObject({
        score: finalState.score,
        moveCount: finalState.moveCount,
        mode: 'duo',
        isYou: true,
      });
      // Already in the visible list, so there is no pinned copy to draw twice.
      expect(board.self).toBeNull();
    }
  }, 10_000);

  it('pays a Classic room but keeps it off both boards', async () => {
    const marker = crypto.randomUUID().slice(0, 8);
    const alice = await createPlayer(`Casual Alice ${marker}`);
    const bob = await createPlayer(`Casual Bob ${marker}`);
    const code = await createRoom('classic');

    const finalSnapshot = await playDuoRoundOut(code, alice, bob);
    expect(finalSnapshot.mode).toBe('classic');

    const finalState = decodeState(finalSnapshot.game);
    const expectedReward = coinReward(finalState.score, finalState.moveCount);
    // Coins still land: casual is not unrewarded, it is only unranked.
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
    for (const board of [leaderboard.body.weekly, leaderboard.body.allTime]) {
      expect(board.entries.filter((entry) => entry.name.includes(marker))).toHaveLength(0);
      expect(board.selfRank).toBeNull();
    }
  }, 10_000);
});
