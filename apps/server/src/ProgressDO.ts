import { DurableObject } from 'cloudflare:workers';
import {
  coinReward,
  isSupportedGameSeed,
  replay,
  weekWindow,
  type ClaimResult,
  type CoinReward,
  type FriendProfile,
  type GameMode,
  type LeaderboardEntry,
  type LeaderboardScope,
  type LeaderboardView,
  type Move,
  type ProgressProfile,
} from '@blokduo/engine';

const FRIEND_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CLASSIC_MOVES = 2_000;
const LEADERBOARD_LIMIT = 50;

export interface ProgressCredentials {
  clientId: string;
  token: string;
}

export type ProgressResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

export interface CreatedPlayer {
  identity: ProgressCredentials;
  profile: ProgressProfile;
}

interface StoredProfile {
  clientId: string;
  tokenHash: string;
  friendCode: string;
  name: string;
  coins: number;
  gamesPlayed: number;
  friendIds: string[];
  createdAt: number;
  updatedAt: number;
}

interface WeeklyScore {
  id: string;
  participantIds: string[];
  names: string[];
  score: number;
  moveCount: number;
  mode: GameMode;
  achievedAt: number;
}

interface StoredClaim {
  reward: CoinReward;
  weeklyBest: boolean;
}

interface DuoSettlement {
  gameId: string;
  players: Array<{ clientId: string; name: string }>;
  score: number;
  moveCount: number;
  ranked: boolean;
}

const ok = <T>(value: T): ProgressResult<T> => ({ ok: true, value });
const fail = <T>(status: number, error: string): ProgressResult<T> => ({
  ok: false,
  status,
  error,
});

/**
 * One serialized, persistent progression authority.
 *
 * Rooms remain independent Durable Objects for low-latency play. Finished
 * results come here so wallets, friendships and weekly boards can be queried
 * across every room. The singleton layout is intentionally simple for the
 * current beta; its public contract can move to D1 without changing clients.
 */
export class ProgressDO extends DurableObject<Record<string, never>> {
  /** Mutating RPCs can interleave at awaits; serialize them for exact-once ledgers. */
  private mutationTail: Promise<void> = Promise.resolve();

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async createPlayer(name: string): Promise<ProgressResult<CreatedPlayer>> {
    return this.mutate(() => this.createPlayerLocked(name));
  }

  private async createPlayerLocked(name: string): Promise<ProgressResult<CreatedPlayer>> {
    const clientId = `p_${randomHex(16)}`;
    const token = randomHex(32);
    const now = Date.now();
    let friendCode = '';

    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = `BD-${randomCode(8)}`;
      if (!(await this.ctx.storage.get<string>(codeKey(candidate)))) {
        friendCode = candidate;
        break;
      }
    }
    if (!friendCode) return fail(503, 'Could not create a friend code');

    const profile: StoredProfile = {
      clientId,
      tokenHash: await hashToken(token),
      friendCode,
      name: cleanName(name),
      coins: 0,
      gamesPlayed: 0,
      friendIds: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.ctx.storage.put({
      [profileKey(clientId)]: profile,
      [codeKey(friendCode)]: clientId,
    });

    return ok({ identity: { clientId, token }, profile: await this.view(profile) });
  }

  /** Authenticate a player and optionally keep their display name current. */
  async profile(
    credentials: ProgressCredentials,
    name?: string,
  ): Promise<ProgressResult<ProgressProfile>> {
    if (name === undefined) {
      const profile = await this.authenticateRecord(credentials);
      return profile
        ? ok(await this.view(profile))
        : fail(401, 'Your player session is no longer valid');
    }
    return this.mutate(() => this.updateProfileLocked(credentials, name));
  }

  private async updateProfileLocked(
    credentials: ProgressCredentials,
    name: string,
  ): Promise<ProgressResult<ProgressProfile>> {
    const profile = await this.authenticateRecord(credentials);
    if (!profile) return fail(401, 'Your player session is no longer valid');

    if (name !== undefined) {
      const nextName = cleanName(name);
      if (profile.name !== nextName) {
        profile.name = nextName;
        profile.updatedAt = Date.now();
        await this.ctx.storage.put(profileKey(profile.clientId), profile);
      }
    }

    return ok(await this.view(profile));
  }

  async addFriend(
    credentials: ProgressCredentials,
    rawCode: string,
  ): Promise<ProgressResult<ProgressProfile>> {
    return this.mutate(() => this.addFriendLocked(credentials, rawCode));
  }

  private async addFriendLocked(
    credentials: ProgressCredentials,
    rawCode: string,
  ): Promise<ProgressResult<ProgressProfile>> {
    const profile = await this.authenticateRecord(credentials);
    if (!profile) return fail(401, 'Your player session is no longer valid');

    const friendCode = normalizeFriendCode(rawCode);
    if (!/^BD-[A-HJ-NP-Z2-9]{8}$/.test(friendCode)) {
      return fail(400, 'Friend codes look like BD-ABCDEFGH');
    }

    const friendId = await this.ctx.storage.get<string>(codeKey(friendCode));
    if (!friendId) return fail(404, 'No player has that friend code');
    if (friendId === profile.clientId) return fail(400, 'That is your own friend code');

    const friend = await this.ctx.storage.get<StoredProfile>(profileKey(friendId));
    if (!friend) return fail(404, 'That player could not be found');

    if (!profile.friendIds.includes(friendId)) profile.friendIds.push(friendId);
    if (!friend.friendIds.includes(profile.clientId)) friend.friendIds.push(profile.clientId);
    profile.updatedAt = Date.now();
    friend.updatedAt = profile.updatedAt;
    await this.ctx.storage.put({
      [profileKey(profile.clientId)]: profile,
      [profileKey(friend.clientId)]: friend,
    });

    return ok(await this.view(profile));
  }

  async removeFriend(
    credentials: ProgressCredentials,
    rawCode: string,
  ): Promise<ProgressResult<ProgressProfile>> {
    return this.mutate(() => this.removeFriendLocked(credentials, rawCode));
  }

  private async removeFriendLocked(
    credentials: ProgressCredentials,
    rawCode: string,
  ): Promise<ProgressResult<ProgressProfile>> {
    const profile = await this.authenticateRecord(credentials);
    if (!profile) return fail(401, 'Your player session is no longer valid');

    const friendId = await this.ctx.storage.get<string>(codeKey(normalizeFriendCode(rawCode)));
    if (!friendId || !profile.friendIds.includes(friendId)) {
      return fail(404, 'That player is not in your friends');
    }

    const friend = await this.ctx.storage.get<StoredProfile>(profileKey(friendId));
    profile.friendIds = profile.friendIds.filter((id) => id !== friendId);
    profile.updatedAt = Date.now();
    const writes: Record<string, StoredProfile> = { [profileKey(profile.clientId)]: profile };
    if (friend) {
      friend.friendIds = friend.friendIds.filter((id) => id !== profile.clientId);
      friend.updatedAt = profile.updatedAt;
      writes[profileKey(friend.clientId)] = friend;
    }
    await this.ctx.storage.put(writes);
    return ok(await this.view(profile));
  }

  async leaderboard(
    credentials: ProgressCredentials,
    mode: GameMode,
    scope: LeaderboardScope,
  ): Promise<ProgressResult<LeaderboardView>> {
    const profile = await this.authenticateRecord(credentials);
    if (!profile) return fail(401, 'Your player session is no longer valid');
    if (mode !== 'classic' && mode !== 'duo') return fail(400, 'Unknown leaderboard mode');
    if (scope !== 'global' && scope !== 'friends') return fail(400, 'Unknown leaderboard scope');

    const week = weekWindow();
    const records = [
      ...(await this.ctx.storage.list<WeeklyScore>({ prefix: scorePrefix(week.key, mode) })).values(),
    ].sort(compareScores);
    const allowed = new Set([profile.clientId, ...profile.friendIds]);
    const filtered =
      scope === 'friends'
        ? records.filter((record) => record.participantIds.some((id) => allowed.has(id)))
        : records;
    const selfIndex = filtered.findIndex((record) => record.participantIds.includes(profile.clientId));
    const visible = filtered.slice(0, LEADERBOARD_LIMIT);

    const entries: LeaderboardEntry[] = visible.map((record, index) => ({
      rank: index + 1,
      name: record.names.join(' + '),
      score: record.score,
      moveCount: record.moveCount,
      mode: record.mode,
      achievedAt: record.achievedAt,
      isYou: record.participantIds.includes(profile.clientId),
      isFriend: record.participantIds.some(
        (id) => id !== profile.clientId && profile.friendIds.includes(id),
      ),
    }));

    return ok({ scope, week, entries, selfRank: selfIndex < 0 ? null : selfIndex + 1 });
  }

  /** Replay the complete transcript; no client-supplied score is ever trusted. */
  async claimClassic(
    credentials: ProgressCredentials,
    seed: number,
    moves: Move[],
  ): Promise<ProgressResult<ClaimResult>> {
    return this.mutate(() => this.claimClassicLocked(credentials, seed, moves));
  }

  private async claimClassicLocked(
    credentials: ProgressCredentials,
    seed: number,
    moves: Move[],
  ): Promise<ProgressResult<ClaimResult>> {
    const profile = await this.authenticateRecord(credentials);
    if (!profile) return fail(401, 'Your player session is no longer valid');
    if (!validSeed(seed) || !Array.isArray(moves) || moves.length > MAX_CLASSIC_MOVES) {
      return fail(400, 'That game transcript is invalid');
    }
    if (!moves.every(validMove)) return fail(400, 'That game transcript is invalid');

    let finalState;
    try {
      finalState = replay(seed, moves);
    } catch {
      return fail(400, 'That game contains an illegal move');
    }
    if (!finalState.over) return fail(400, 'Only completed games earn coins');

    const fingerprint = await hashToken(JSON.stringify([seed, moves]));
    const claimKey = `claim:classic:${profile.clientId}:${fingerprint}`;
    const previous = await this.ctx.storage.get<StoredClaim>(claimKey);
    if (previous) {
      return ok({
        awarded: false,
        reward: previous.reward,
        weeklyBest: previous.weeklyBest,
        profile: await this.view(profile),
      });
    }

    const reward = coinReward(finalState.score, finalState.moveCount);
    const weeklyRecord: WeeklyScore = {
      id: profile.clientId,
      participantIds: [profile.clientId],
      names: [profile.name],
      score: finalState.score,
      moveCount: finalState.moveCount,
      mode: 'classic',
      achievedAt: Date.now(),
    };
    const weekly = await this.weeklyUpdate(weeklyRecord);
    const weeklyBest = weekly.update;

    profile.coins = safeAdd(profile.coins, reward.totalCoins);
    profile.gamesPlayed += 1;
    profile.updatedAt = Date.now();
    const writes: Record<string, StoredProfile | StoredClaim | WeeklyScore> = {
      [profileKey(profile.clientId)]: profile,
      [claimKey]: { reward, weeklyBest } satisfies StoredClaim,
    };
    if (weekly.update) writes[weekly.key] = weeklyRecord;
    await this.ctx.storage.put(writes);

    return ok({ awarded: true, reward, weeklyBest, profile: await this.view(profile) });
  }

  /** Called only by a RoomDO after an authoritative, natural Duo game over. */
  async settleDuo(input: DuoSettlement): Promise<ProgressResult<boolean>> {
    return this.mutate(() => this.settleDuoLocked(input));
  }

  private async settleDuoLocked(input: DuoSettlement): Promise<ProgressResult<boolean>> {
    if (!input.gameId || !Array.isArray(input.players) || input.players.length !== 2) {
      return fail(400, 'Invalid Duo result');
    }
    const participants = [...new Set(input.players.map((player) => player.clientId))];
    if (participants.length !== 2) return fail(400, 'Duo needs two distinct players');

    const claimKey = `claim:duo:${input.gameId}`;
    if (await this.ctx.storage.get(claimKey)) return ok(false);

    const profiles = await Promise.all(
      participants.map((id) => this.ctx.storage.get<StoredProfile>(profileKey(id))),
    );
    if (profiles.some((profile) => !profile)) return fail(404, 'A Duo player no longer exists');

    const reward = coinReward(input.score, input.moveCount);
    const now = Date.now();
    const writes: Record<string, StoredProfile | StoredClaim | WeeklyScore> = {};
    for (const profile of profiles as StoredProfile[]) {
      profile.coins = safeAdd(profile.coins, reward.totalCoins);
      profile.gamesPlayed += 1;
      profile.updatedAt = now;
      writes[profileKey(profile.clientId)] = profile;
    }

    let weeklyBest = false;
    let weeklyWrite: { key: string; record: WeeklyScore } | null = null;
    if (input.ranked) {
      const sortedPlayers = [...input.players].sort((a, b) => a.clientId.localeCompare(b.clientId));
      const pairId = sortedPlayers.map((player) => player.clientId).join('+');
      const record: WeeklyScore = {
        id: pairId,
        participantIds: sortedPlayers.map((player) => player.clientId),
        names: sortedPlayers.map((player) => cleanName(player.name)),
        score: reward.score,
        moveCount: reward.moveCount,
        mode: 'duo',
        achievedAt: now,
      };
      const weekly = await this.weeklyUpdate(record);
      weeklyBest = weekly.update;
      if (weekly.update) weeklyWrite = { key: weekly.key, record };
    }

    writes[claimKey] = { reward, weeklyBest };
    if (weeklyWrite) writes[weeklyWrite.key] = weeklyWrite.record;
    await this.ctx.storage.put(writes);
    return ok(true);
  }

  private async authenticateRecord(
    credentials: ProgressCredentials,
  ): Promise<StoredProfile | null> {
    if (!credentials?.clientId || !credentials?.token) return null;
    const profile = await this.ctx.storage.get<StoredProfile>(profileKey(credentials.clientId));
    if (!profile || profile.tokenHash !== (await hashToken(credentials.token))) return null;
    return profile;
  }

  private async view(profile: StoredProfile): Promise<ProgressProfile> {
    const friends = await Promise.all(
      profile.friendIds.map((id) => this.ctx.storage.get<StoredProfile>(profileKey(id))),
    );
    return {
      clientId: profile.clientId,
      friendCode: profile.friendCode,
      name: profile.name,
      coins: profile.coins,
      gamesPlayed: profile.gamesPlayed,
      friends: friends
        .filter((friend): friend is StoredProfile => !!friend)
        .map<FriendProfile>((friend) => ({ friendCode: friend.friendCode, name: friend.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  private async weeklyUpdate(
    record: WeeklyScore,
  ): Promise<{ key: string; update: boolean }> {
    const week = weekWindow(record.achievedAt);
    const key = scoreKey(week.key, record.mode, record.id);
    const previous = await this.ctx.storage.get<WeeklyScore>(key);
    if (
      previous &&
      (previous.score > record.score ||
        (previous.score === record.score && previous.achievedAt <= record.achievedAt))
    ) {
      return { key, update: false };
    }
    return { key, update: true };
  }
}

function profileKey(clientId: string) {
  return `profile:${clientId}`;
}

function codeKey(friendCode: string) {
  return `code:${friendCode}`;
}

function scorePrefix(week: string, mode: GameMode) {
  return `score:${week}:${mode}:`;
}

function scoreKey(week: string, mode: GameMode, id: string) {
  return `${scorePrefix(week, mode)}${id}`;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return 'Player';
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
  return cleaned || 'Player';
}

function normalizeFriendCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function validSeed(seed: number): boolean {
  return isSupportedGameSeed(seed);
}

function validMove(move: Move): boolean {
  return (
    !!move &&
    Number.isInteger(move.slot) &&
    move.slot >= 0 &&
    move.slot <= 2 &&
    Number.isInteger(move.row) &&
    move.row >= 0 &&
    move.row <= 7 &&
    Number.isInteger(move.col) &&
    move.col >= 0 &&
    move.col <= 7
  );
}

function compareScores(a: WeeklyScore, b: WeeklyScore): number {
  return b.score - a.score || a.achievedAt - b.achievedAt || a.id.localeCompare(b.id);
}

function safeAdd(a: number, b: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, a + b);
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((value) => FRIEND_ALPHABET[value % FRIEND_ALPHABET.length]).join('');
}

async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
