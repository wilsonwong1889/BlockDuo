import { DurableObject } from 'cloudflare:workers';
import {
  actionKind,
  coinReward,
  isSupportedGameSeed,
  POWER_COSTS,
  replayActions,
  wheelSegment,
  WHEEL_COST_COINS,
  WHEEL_TOTAL_WEIGHT,
  weekWindow,
  type ClaimResult,
  type CoinReward,
  type FriendProfile,
  type GameMode,
  type LeaderboardEntry,
  type LeaderboardScope,
  type LeaderboardView,
  type GameAction,
  type Move,
  type PlayerStats,
  type PowerName,
  type ProgressProfile,
  type PublicProfile,
  type WheelResult,
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
  /** Absent on profiles created before gems existed, which is the same as none. */
  gems?: number;
  gamesPlayed: number;
  friendIds: string[];
  createdAt: number;
  updatedAt: number;
  /** Lifetime totals. Absent on profiles created before profiles were public. */
  classicGames?: number;
  duoGames?: number;
  bestScore?: number;
  totalScore?: number;
  totalLines?: number;
  bestStreak?: number;
  lastPlayedAt?: number;
}

/** One finished, server-verified game, folded into a profile's totals. */
interface GameOutcome {
  mode: GameMode;
  score: number;
  lines: number;
  bestStreak: number;
}

function recordOutcome(profile: StoredProfile, outcome: GameOutcome, at: number): void {
  profile.gamesPlayed += 1;
  profile.lastPlayedAt = at;
  if (outcome.mode === 'classic') profile.classicGames = (profile.classicGames ?? 0) + 1;
  else profile.duoGames = (profile.duoGames ?? 0) + 1;
  profile.bestScore = Math.max(profile.bestScore ?? 0, outcome.score);
  profile.totalScore = (profile.totalScore ?? 0) + outcome.score;
  profile.totalLines = (profile.totalLines ?? 0) + outcome.lines;
  profile.bestStreak = Math.max(profile.bestStreak ?? 0, outcome.bestStreak);
}

function statsOf(profile: StoredProfile): PlayerStats {
  return {
    gamesPlayed: profile.gamesPlayed,
    classicGames: profile.classicGames ?? 0,
    duoGames: profile.duoGames ?? 0,
    bestScore: profile.bestScore ?? 0,
    totalScore: profile.totalScore ?? 0,
    totalLines: profile.totalLines ?? 0,
    bestStreak: profile.bestStreak ?? 0,
    coins: profile.coins,
    lastPlayedAt: profile.lastPlayedAt ?? null,
  };
}

/**
 * One best-score record. The same shape is stored twice — once under the week
 * it happened in, once under the all-time window — so a board is a prefix scan
 * either way, and both stay bounded by the number of players rather than by
 * the number of games ever played.
 */
interface RankedScore {
  id: string;
  participantIds: string[];
  names: string[];
  score: number;
  moveCount: number;
  mode: GameMode;
  achievedAt: number;
}

/** The window a record is filed under. Weeks use their Monday's date. */
const ALL_TIME = 'alltime';

/** Set once the pre-existing weeks have been folded into the all-time window. */
const ALL_TIME_BACKFILL_KEY = 'migration:alltime:v1';

/** Set once profiles have taken their best score from the boards. */
const STATS_BACKFILL_KEY = 'migration:stats:v1';

/** Durable Object storage takes at most 128 keys in one put. */
const MAX_PUT_KEYS = 100;

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
  /** From the room's own state. Absent from a Worker deployed before profiles. */
  lines?: number;
  bestStreak?: number;
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

    await this.ensureMigrations();

    const week = weekWindow();
    const allowed = new Set([profile.clientId, ...profile.friendIds]);

    const board = async (window: string) => {
      const records = [
        ...(await this.ctx.storage.list<RankedScore>({ prefix: scorePrefix(window, mode) })).values(),
      ].sort(compareScores);
      const filtered =
        scope === 'friends'
          ? records.filter((record) => record.participantIds.some((id) => allowed.has(id)))
          : records;
      // Found before the visible slice, so your rank is still reported when you
      // are further down the board than it shows.
      const selfIndex = filtered.findIndex((record) =>
        record.participantIds.includes(profile.clientId),
      );

      const toEntry = (record: RankedScore, index: number): LeaderboardEntry => ({
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
      });

      const entries = filtered.slice(0, LEADERBOARD_LIMIT).map(toEntry);
      // Sent separately only when it is past the cut; inside the list it is
      // already there, and sending it twice would draw it twice.
      const self =
        selfIndex >= LEADERBOARD_LIMIT ? toEntry(filtered[selfIndex], selfIndex) : null;

      // Resolved for the visible rows only, and read rather than stored on the
      // record, so every score already on the board gets one without migrating.
      const shown = [...filtered.slice(0, LEADERBOARD_LIMIT)];
      if (selfIndex >= LEADERBOARD_LIMIT) shown.push(filtered[selfIndex]);
      const codes = await this.friendCodesFor(shown.flatMap((record) => record.participantIds));
      const attach = (entry: LeaderboardEntry, record: RankedScore) => {
        const resolved = record.participantIds.map((id) => codes.get(id));
        if (resolved.every((code): code is string => !!code)) entry.friendCodes = resolved;
      };
      entries.forEach((entry, index) => attach(entry, filtered[index]));
      if (self) attach(self, filtered[selfIndex]);

      return { entries, selfRank: selfIndex < 0 ? null : selfIndex + 1, self };
    };

    return ok({
      scope,
      week,
      allTime: await board(ALL_TIME),
      weekly: await board(week.key),
    });
  }

  /**
   * A player's profile as anyone may see it.
   *
   * Keyed by friend code, which is the identifier players already hand out;
   * the clientId is never accepted here and never returned, so a public link
   * cannot be turned into anything that acts on the account. No credentials are
   * required — that is what makes it public.
   */
  async publicProfile(rawCode: string): Promise<ProgressResult<PublicProfile>> {
    await this.ensureMigrations();

    const friendCode = normalizeFriendCode(rawCode);
    if (!friendCode) return fail(400, 'That is not a player code');

    const clientId = await this.ctx.storage.get<string>(codeKey(friendCode));
    const profile = clientId
      ? await this.ctx.storage.get<StoredProfile>(profileKey(clientId))
      : null;
    if (!profile) return fail(404, 'No player with that code');

    return ok({
      friendCode: profile.friendCode,
      name: profile.name,
      joinedAt: profile.createdAt,
      stats: statsOf(profile),
    });
  }

  /**
   * Spin the wheel: coins in, gems out.
   *
   * The roll happens here because the prize is the whole point of the spin —
   * a client that picked its own segment would simply always pick fifty.
   */
  async spinWheel(credentials: ProgressCredentials): Promise<ProgressResult<WheelResult>> {
    return this.mutate(async () => {
      const profile = await this.authenticateRecord(credentials);
      if (!profile) return fail<WheelResult>(401, 'Your player session is no longer valid');
      if (profile.coins < WHEEL_COST_COINS) {
        return fail<WheelResult>(400, 'Not enough coins for a spin');
      }

      const segment = wheelSegment(randomRoll(WHEEL_TOTAL_WEIGHT));
      profile.coins -= WHEEL_COST_COINS;
      profile.gems = (profile.gems ?? 0) + segment.gems;
      profile.updatedAt = Date.now();
      await this.ctx.storage.put(profileKey(profile.clientId), profile);

      return ok({ gems: segment.gems, profile: await this.view(profile) });
    });
  }

  /**
   * Pay for one power, now rather than when the game is claimed.
   *
   * A game can be abandoned and never claimed, so charging at the end would
   * hand out free powers to anyone who closed the tab.
   */
  async spendGems(
    credentials: ProgressCredentials,
    power: PowerName,
  ): Promise<ProgressResult<ProgressProfile>> {
    return this.mutate(async () => {
      const profile = await this.authenticateRecord(credentials);
      if (!profile) return fail<ProgressProfile>(401, 'Your player session is no longer valid');

      const cost = POWER_COSTS[power];
      if (!cost) return fail<ProgressProfile>(400, 'Unknown power');
      if ((profile.gems ?? 0) < cost) return fail<ProgressProfile>(400, 'Not enough gems');

      profile.gems = (profile.gems ?? 0) - cost;
      profile.updatedAt = Date.now();
      await this.ctx.storage.put(profileKey(profile.clientId), profile);
      return ok(await this.view(profile));
    });
  }

  /** Replay the complete transcript; no client-supplied score is ever trusted. */
  async claimClassic(
    credentials: ProgressCredentials,
    seed: number,
    moves: GameAction[],
  ): Promise<ProgressResult<ClaimResult>> {
    return this.mutate(() => this.claimClassicLocked(credentials, seed, moves));
  }

  private async claimClassicLocked(
    credentials: ProgressCredentials,
    seed: number,
    moves: GameAction[],
  ): Promise<ProgressResult<ClaimResult>> {
    const profile = await this.authenticateRecord(credentials);
    if (!profile) return fail(401, 'Your player session is no longer valid');
    if (!validSeed(seed) || !Array.isArray(moves) || moves.length > MAX_CLASSIC_MOVES) {
      return fail(400, 'That game transcript is invalid');
    }
    if (!moves.every(validAction)) return fail(400, 'That game transcript is invalid');

    let finalState;
    try {
      // Powers are part of the transcript, so a game that used them is checked
      // exactly as strictly as one that did not: the replay enforces the undo
      // limit and refuses a rotation of an empty slot.
      finalState = replayActions(seed, moves);
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
    const record: RankedScore = {
      id: profile.clientId,
      participantIds: [profile.clientId],
      names: [profile.name],
      score: finalState.score,
      moveCount: finalState.moveCount,
      mode: 'classic',
      achievedAt: Date.now(),
    };
    const ranked = await this.rankedWrites(record);

    profile.coins = safeAdd(profile.coins, reward.totalCoins);
    const finishedAt = Date.now();
    recordOutcome(
      profile,
      {
        mode: 'classic',
        score: finalState.score,
        lines: finalState.linesCleared,
        bestStreak: finalState.bestStreak,
      },
      finishedAt,
    );
    profile.updatedAt = finishedAt;
    const writes: Record<string, StoredProfile | StoredClaim | RankedScore> = {
      ...ranked.writes,
      [profileKey(profile.clientId)]: profile,
      [claimKey]: { reward, weeklyBest: ranked.weeklyBest } satisfies StoredClaim,
    };
    await this.ctx.storage.put(writes);
    const weeklyBest = ranked.weeklyBest;

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
    const writes: Record<string, StoredProfile | StoredClaim | RankedScore> = {};
    for (const profile of profiles as StoredProfile[]) {
      profile.coins = safeAdd(profile.coins, reward.totalCoins);
      // Duo is co-operative: the team's board is the one both players played,
      // so both take the same result rather than a share of it.
      recordOutcome(
        profile,
        {
          mode: 'duo',
          score: reward.score,
          lines: Math.max(0, Math.floor(input.lines ?? 0)),
          bestStreak: Math.max(0, Math.floor(input.bestStreak ?? 0)),
        },
        now,
      );
      profile.updatedAt = now;
      writes[profileKey(profile.clientId)] = profile;
    }

    // Coins are paid for any completed Duo game; only a Ranked room reaches the
    // boards. A minute a turn is a different game from five seconds a turn, and
    // one leaderboard cannot hold both honestly.
    let weeklyBest = false;
    if (input.ranked) {
      const sortedPlayers = [...input.players].sort((a, b) => a.clientId.localeCompare(b.clientId));
      const pairId = sortedPlayers.map((player) => player.clientId).join('+');
      const record: RankedScore = {
        id: pairId,
        participantIds: sortedPlayers.map((player) => player.clientId),
        names: sortedPlayers.map((player) => cleanName(player.name)),
        score: reward.score,
        moveCount: reward.moveCount,
        mode: 'duo',
        achievedAt: now,
      };
      const ranked = await this.rankedWrites(record);
      weeklyBest = ranked.weeklyBest;
      Object.assign(writes, ranked.writes);
    }

    writes[claimKey] = { reward, weeklyBest };
    await this.ctx.storage.put(writes);
    return ok(true);
  }

  /**
   * Give profiles the one lifetime stat the ledger can still prove.
   *
   * Totals only began being counted when profiles became public, so a player
   * with games behind them had "Games played 1" beside a best score of zero.
   * The all-time board is a record of everyone's best game, so that number can
   * be recovered exactly. Totals, lines and streaks cannot — nothing ever stored
   * them — and they start accumulating from here.
   */
  private async backfillStats(): Promise<void> {
    if (await this.ctx.storage.get(STATS_BACKFILL_KEY)) return;

    await this.mutate(async () => {
      if (await this.ctx.storage.get(STATS_BACKFILL_KEY)) return;

      const best = new Map<string, number>();
      for (const mode of ['classic', 'duo'] as const) {
        const records = await this.ctx.storage.list<RankedScore>({
          prefix: scorePrefix(ALL_TIME, mode),
        });
        for (const record of records.values()) {
          // A Duo record belongs to both players; the team's board is the one
          // each of them played.
          for (const id of record.participantIds ?? []) {
            best.set(id, Math.max(best.get(id) ?? 0, record.score));
          }
        }
      }

      const ids = [...best.keys()];
      for (let i = 0; i < ids.length; i += MAX_PUT_KEYS) {
        const slice = ids.slice(i, i + MAX_PUT_KEYS);
        const found = await this.ctx.storage.get<StoredProfile>(slice.map(profileKey));
        const writes: Record<string, StoredProfile> = {};
        for (const profile of found.values()) {
          if (!profile?.clientId) continue;
          const recovered = best.get(profile.clientId) ?? 0;
          if (recovered <= (profile.bestScore ?? 0)) continue;
          profile.bestScore = recovered;
          writes[profileKey(profile.clientId)] = profile;
        }
        if (Object.keys(writes).length) await this.ctx.storage.put(writes);
      }

      await this.ctx.storage.put(STATS_BACKFILL_KEY, Date.now());
    });
  }

  /** Every repair the stored ledger might still need, in dependency order. */
  private async ensureMigrations(): Promise<void> {
    await this.backfillAllTime();
    await this.backfillStats();
  }

  /** clientId to public code, batched, for the rows actually being shown. */
  private async friendCodesFor(clientIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(clientIds)];
    const codes = new Map<string, string>();

    // Durable Object storage reads at most 128 keys at a time.
    for (let i = 0; i < unique.length; i += MAX_PUT_KEYS) {
      const slice = unique.slice(i, i + MAX_PUT_KEYS);
      const found = await this.ctx.storage.get<StoredProfile>(slice.map(profileKey));
      for (const profile of found.values()) {
        if (profile?.clientId) codes.set(profile.clientId, profile.friendCode);
      }
    }
    return codes;
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
      gems: profile.gems ?? 0,
      gamesPlayed: profile.gamesPlayed,
      friends: friends
        .filter((friend): friend is StoredProfile => !!friend)
        .map<FriendProfile>((friend) => ({ friendCode: friend.friendCode, name: friend.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /**
   * The writes this record earns, in both windows.
   *
   * A window only takes the record if it beats what is already filed there, so
   * a great score stays on the all-time board after its week has rolled over.
   * `weeklyBest` is reported separately because that is what the end-of-game
   * card celebrates.
   */
  private async rankedWrites(
    record: RankedScore,
  ): Promise<{ writes: Record<string, RankedScore>; weeklyBest: boolean }> {
    const week = weekWindow(record.achievedAt);
    const writes: Record<string, RankedScore> = {};
    let weeklyBest = false;

    for (const window of [week.key, ALL_TIME]) {
      const key = scoreKey(window, record.mode, record.id);
      const previous = await this.ctx.storage.get<RankedScore>(key);
      if (!beats(record, previous)) continue;
      writes[key] = record;
      if (window === week.key) weeklyBest = true;
    }

    return { writes, weeklyBest };
  }

  /**
   * Fold every week ever recorded into the all-time window, once.
   *
   * All-time records only began being written when the board was added, so a
   * ledger with history behind it had weeks of results and a permanent board
   * that started empty — showing an "all time" board that was a subset of this
   * week, missing anyone who had not played since. The weekly records are the
   * per-player bests already, so the whole history is one scan away.
   */
  private async backfillAllTime(): Promise<void> {
    if (await this.ctx.storage.get(ALL_TIME_BACKFILL_KEY)) return;

    await this.mutate(async () => {
      // Re-checked under the lock: two readers can arrive together.
      if (await this.ctx.storage.get(ALL_TIME_BACKFILL_KEY)) return;

      // Existing all-time records are in the scan too, so a rerun can only
      // confirm what is already filed rather than undo it.
      const best = new Map<string, RankedScore>();
      let startAfter: string | undefined;
      for (;;) {
        const page = await this.ctx.storage.list<RankedScore>({
          prefix: 'score:',
          limit: 1_000,
          startAfter,
        });
        if (page.size === 0) break;
        for (const [key, record] of page) {
          startAfter = key;
          if (!record?.id || (record.mode !== 'classic' && record.mode !== 'duo')) continue;
          const target = scoreKey(ALL_TIME, record.mode, record.id);
          if (beats(record, best.get(target))) best.set(target, record);
        }
        if (page.size < 1_000) break;
      }

      const entries = [...best.entries()];
      for (let i = 0; i < entries.length; i += MAX_PUT_KEYS) {
        await this.ctx.storage.put(Object.fromEntries(entries.slice(i, i + MAX_PUT_KEYS)));
      }
      await this.ctx.storage.put(ALL_TIME_BACKFILL_KEY, Date.now());
    });
  }
}

/** A uniform whole number in [0, bound), from the platform's CSPRNG. */
function randomRoll(bound: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % bound;
}

function profileKey(clientId: string) {
  return `profile:${clientId}`;
}

function codeKey(friendCode: string) {
  return `code:${friendCode}`;
}

function scorePrefix(window: string, mode: GameMode) {
  return `score:${window}:${mode}:`;
}

function scoreKey(window: string, mode: GameMode, id: string) {
  return `${scorePrefix(window, mode)}${id}`;
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

/**
 * A transcript entry the replay could plausibly be handed.
 *
 * The replay decides whether it was actually legal; this only keeps obvious
 * rubbish out of it, and refuses tags that are not powers so an unknown one
 * cannot be silently treated as a placement.
 */
function validAction(action: GameAction): boolean {
  if (!action || typeof action !== 'object') return false;
  const kind = actionKind(action);
  if (kind === 'undo' || kind === 'reroll') return true;
  if (kind === 'rotate') {
    const { slot } = action as { slot: number };
    return Number.isInteger(slot) && slot >= 0 && slot <= 2;
  }
  if (kind !== 'place') return false;
  return validMove(action as Move);
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

/** Whether a candidate should take a window's slot. Equal scores keep the earlier. */
function beats(candidate: RankedScore, incumbent: RankedScore | undefined): boolean {
  if (!incumbent) return true;
  if (incumbent.score !== candidate.score) return incumbent.score < candidate.score;
  return incumbent.achievedAt > candidate.achievedAt;
}

function compareScores(a: RankedScore, b: RankedScore): number {
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
