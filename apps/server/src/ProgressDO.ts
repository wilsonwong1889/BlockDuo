import { DurableObject } from 'cloudflare:workers';
import {
  actionKind,
  ALL_TIME_LEADERBOARD_SIZE,
  coinReward,
  cleanName,
  FALLBACK_NAME,
  isAllowedName,
  isRankedTranscript,
  isSupportedGameSeed,
  POWER_COSTS,
  replayActions,
  nextUnmarkedWedge,
  wheelWedgeAt,
  WHEEL_COST_COINS,
  WHEEL_WEDGES,
  WHEEL_WEDGE_TOTAL,
  MAX_AD_SPINS_PER_DAY,
  utcDayKey,
  weekWindow,
  type ClaimResult,
  type CoinReward,
  type FriendProfile,
  type GameMode,
  type LeaderboardEntry,
  type LeaderboardPlaces,
  type LeaderboardScope,
  type LeaderboardView,
  type GameAction,
  type Move,
  type PlayerStats,
  type PowerName,
  type ProgressProfile,
  type PublicProfile,
  type WheelResult,
  WEEKLY_LEADERBOARD_SIZE,
} from '@blokduo/engine';

const FRIEND_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CLASSIC_MOVES = 2_000;

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
  /** The UTC day whose free spin has been taken. */
  freeSpinDay?: string;
  /** The UTC day the advert spins below were counted against. */
  adSpinDay?: string;
  adSpinsUsed?: number;
  /**
   * Wedges struck off the wheel, in `WHEEL_WEDGES` order.
   *
   * Absent on profiles from before the wheel remembered anything, which is the
   * same as a full board.
   */
  markedWedges?: number[];
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

/**
 * The window a record is filed under. Weeks use their Monday's date.
 *
 * All-time records are permanent: one key per player (or per Duo pair) that is
 * only ever overwritten by that same player beating it, and never expired,
 * swept or trimmed. The board is capped at what it *shows*, not at what it
 * keeps, so a name on it stays on it until somebody plays better.
 */
const ALL_TIME = 'alltime';

/** Set once the pre-existing weeks have been folded into the all-time window. */
const ALL_TIME_BACKFILL_KEY = 'migration:alltime:v1';

/** Set once profiles have taken their best score from the boards. */
const STATS_BACKFILL_KEY = 'migration:stats:v1';

/** Daily counts are kept this long, then dropped. */
const METRIC_RETENTION_DAYS = 90;

/** Durable Object storage takes at most 128 keys in one put. */
const MAX_PUT_KEYS = 100;

/**
 * How long a transfer code is worth anything.
 *
 * A code is a bearer credential for somebody's whole profile, so it is meant
 * to survive the walk from one tab to another and nothing longer. Long enough
 * that a slow page load or a paste into another browser still works.
 */
const TRANSFER_TTL_MS = 15 * 60_000;

interface StoredTransfer {
  clientId: string;
  /**
   * The token handed back on claim.
   *
   * Kept rather than reissued so the original device keeps working: moving
   * progress to a new domain should not log anybody out of the old one. Only
   * the profile's own holder can mint this, it dies in fifteen minutes, and it
   * is deleted the first time it is read.
   */
  token: string;
  expiresAt: number;
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
/**
 * How long a sorted board is reused before it is read again.
 *
 * The scan is the expensive part and it is identical for everyone looking at
 * the same board, so it is done once a minute rather than once a reader. A
 * score set inside that minute is folded into what is held rather than waiting
 * for it to lapse, so the cache costs a rescan and not accuracy.
 */
const BOARD_CACHE_MS = 60_000;

/**
 * What one address may create per hour.
 *
 * Both mint something permanent-ish: a profile is a key that never goes away,
 * and a room is a Durable Object. Rooms are the looser of the two because they
 * clean themselves up when idle and because a group passing codes around
 * genuinely makes several.
 */
const LIMITS = {
  signup: { max: 6, windowMs: 60 * 60_000 },
  room: { max: 30, windowMs: 60 * 60_000 },
} as const;

type LimitName = keyof typeof LIMITS;

export class ProgressDO extends DurableObject<Record<string, never>> {
  /** Mutating RPCs can interleave at awaits; serialize them for exact-once ledgers. */
  private mutationTail: Promise<void> = Promise.resolve();

  /**
   * Recent sign-ups per address, in memory rather than in storage.
   *
   * Every profile is a permanent key, so an unbounded mint is unbounded growth.
   * Keeping the counters in memory means they cost nothing to store and are
   * lost if this object is ever evicted — which is fine, because eviction only
   * happens when nothing is going on, and a limiter matters under load.
   */
  private recentActions = new Map<string, number[]>();

  /**
   * Sorted score records per board.
   *
   * In memory rather than in storage: losing it costs one rescan, and keeping
   * it in storage would mean writing on every read.
   */
  private boards = new Map<string, { at: number; records: RankedScore[] }>();

  /** The day whose metric sweep has already run on this object. */
  private sweptDay = '';

  private async sortedBoard(window: string, mode: GameMode): Promise<RankedScore[]> {
    const key = `${window}:${mode}`;
    const cached = this.boards.get(key);
    if (cached && Date.now() - cached.at < BOARD_CACHE_MS) return cached.records;

    const records = [
      ...(await this.ctx.storage.list<RankedScore>({ prefix: scorePrefix(window, mode) })).values(),
    ].sort(compareScores);

    // Only the current windows are worth holding; last week's board is read
    // once in a blue moon and would otherwise sit in memory for ever.
    if (this.boards.size > 8) this.boards.clear();
    this.boards.set(key, { at: Date.now(), records });
    return records;
  }

  private allowed(limit: LimitName, address: string): boolean {
    // No address is local development or a test; there is nobody to limit.
    if (!address) return true;

    const { max, windowMs } = LIMITS[limit];
    const bucket = `${limit}:${address}`;
    const now = Date.now();
    const recent = (this.recentActions.get(bucket) ?? []).filter((at) => now - at < windowMs);

    if (recent.length >= max) {
      this.recentActions.set(bucket, recent);
      return false;
    }

    recent.push(now);
    this.recentActions.set(bucket, recent);

    // Bounded upkeep: drop addresses whose window has passed entirely, so a
    // long-lived object does not accumulate a row per visitor it ever saw.
    if (this.recentActions.size > 5_000) {
      for (const [seen, times] of this.recentActions) {
        if (times.every((at) => now - at >= windowMs)) this.recentActions.delete(seen);
      }
    }
    return true;
  }

  /** Asked before a room is minted, because a room is a Durable Object too. */
  async allowRoomCreate(address: string): Promise<boolean> {
    const allowed = this.allowed('room', address);
    if (allowed) await this.count('room.created');
    return allowed;
  }

  /**
   * One more of something happened today.
   *
   * Counted here rather than reported by the browser, so the numbers describe
   * what the server actually did. Nothing identifies anybody: a day and a name
   * and a number, which is enough to see whether people are playing and far
   * less than enough to see who.
   */
  private async count(name: string): Promise<void> {
    const day = utcDayKey();
    const key = `metric:${day}:${name}`;
    const current = (await this.ctx.storage.get<number>(key)) ?? 0;
    await this.ctx.storage.put(key, current + 1);

    // Yesterday's first write is when the old days go, so the sweep happens
    // once a day rather than on every count.
    if (this.sweptDay === day) return;
    this.sweptDay = day;
    const cutoff = utcDayKey(Date.now() - METRIC_RETENTION_DAYS * 24 * 60 * 60_000);
    const stale = await this.ctx.storage.list<number>({
      prefix: 'metric:',
      end: `metric:${cutoff}`,
    });
    if (stale.size) await this.ctx.storage.delete([...stale.keys()]);
  }

  /** Daily counts, newest day first. Aggregate only. */
  async metrics(days = 14): Promise<ProgressResult<Array<Record<string, number | string>>>> {
    const wanted = Math.min(90, Math.max(1, Math.floor(days)));
    const since = utcDayKey(Date.now() - (wanted - 1) * 24 * 60 * 60_000);
    const rows = await this.ctx.storage.list<number>({ prefix: 'metric:', start: `metric:${since}` });

    const byDay = new Map<string, Record<string, number | string>>();
    for (const [key, value] of rows) {
      const [, day, ...rest] = key.split(':');
      const name = rest.join(':');
      const row = byDay.get(day) ?? { day };
      row[name] = value;
      byDay.set(day, row);
    }
    return ok([...byDay.values()].sort((a, b) => String(b.day).localeCompare(String(a.day))));
  }

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

  async createPlayer(name: string, address = ''): Promise<ProgressResult<CreatedPlayer>> {
    if (!this.allowed('signup', address)) {
      return fail(429, 'Too many new players from here. Try again later.');
    }
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

    await this.count('player.created');
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
      // A player who picks a name has to be told it was refused. Everywhere
      // else — a Duo result recording who played — falls back quietly instead.
      if (typeof name === 'string' && name.trim() && !isAllowedName(name.trim())) {
        return fail(400, 'That name is not allowed. Please pick another.');
      }
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

    const board = async (window: string, size: number) => {
      const records = await this.sortedBoard(window, mode);
      const filtered =
        scope === 'friends'
          ? records.filter((record) => record.participantIds.some((id) => allowed.has(id)))
          : records;
      // Counted over the whole board rather than the slice being sent, so a
      // player far below the last row still gets their real place back. The row
      // itself is not sent: below the cut is below the cut, and the number is
      // what the profile shows.
      const selfIndex = filtered.findIndex((record) =>
        record.participantIds.includes(profile.clientId),
      );

      const shown = filtered.slice(0, size);
      // Read for the visible rows only, and read rather than stored on the
      // record, so every score already on the board gets both without
      // migrating anything.
      const identities = await this.identitiesFor(
        shown.flatMap((record) => record.participantIds),
      );

      /**
       * Who to put on the row: the name the player goes by now.
       *
       * The record keeps the name that set it, and everybody starts out called
       * "Player" — so a board drawn from the records is a board of people who
       * had not picked a name yet. The stored name is only the fallback, for a
       * profile that no longer exists to ask.
       */
      const displayName = (record: RankedScore) =>
        record.participantIds
          .map((id, seat) => identities.get(id)?.name ?? record.names[seat] ?? FALLBACK_NAME)
          .join(' + ');

      const entries = shown.map<LeaderboardEntry>((record, index) => ({
        rank: index + 1,
        name: displayName(record),
        score: record.score,
        moveCount: record.moveCount,
        mode: record.mode,
        achievedAt: record.achievedAt,
        isYou: record.participantIds.includes(profile.clientId),
        isFriend: record.participantIds.some(
          (id) => id !== profile.clientId && profile.friendIds.includes(id),
        ),
      }));

      entries.forEach((entry, index) => {
        const resolved = shown[index].participantIds.map((id) => identities.get(id)?.friendCode);
        if (resolved.every((code): code is string => !!code)) entry.friendCodes = resolved;
      });

      return { entries, selfRank: selfIndex < 0 ? null : selfIndex + 1 };
    };

    return ok({
      scope,
      week,
      allTime: await board(ALL_TIME, ALL_TIME_LEADERBOARD_SIZE),
      weekly: await board(week.key, WEEKLY_LEADERBOARD_SIZE),
    });
  }

  /**
   * Where one player stands on each all-time board.
   *
   * Every record is counted, not only the hundred the board draws, so a place
   * of 1,240th is a real position rather than "off the board". Both modes are
   * read from the same cached scan the leaderboard itself uses.
   */
  private async allTimePlaces(clientId: string): Promise<LeaderboardPlaces> {
    const placeIn = async (mode: GameMode): Promise<number | null> => {
      const records = await this.sortedBoard(ALL_TIME, mode);
      const index = records.findIndex((record) =>
        (record.participantIds ?? []).includes(clientId),
      );
      return index < 0 ? null : index + 1;
    };

    return { classic: await placeIn('classic'), duo: await placeIn('duo') };
  }

  /**
   * A player's profile as anyone may see it.
   *
   * Keyed by friend code, which is the identifier players already hand out;
   * the clientId is never accepted here and never returned, so a public link
   * cannot be turned into anything that acts on the account. No credentials are
   * required — that is what makes it public.
   */
  /**
   * Mint a one-time code that moves this profile to another origin.
   *
   * The progression data was never split — one Durable Object serves every
   * hostname — but the credentials that name a player live in localStorage,
   * which browsers key per origin. So a player arriving on a new domain is
   * handed a new profile while their real one carries on existing without
   * them. This is how they carry the credentials across.
   */
  async createTransfer(
    credentials: ProgressCredentials,
  ): Promise<ProgressResult<{ code: string; expiresAt: number }>> {
    await this.ensureMigrations();
    const profile = await this.authenticateRecord(credentials);
    if (!profile) return fail(401, 'Not signed in on this device');

    return this.mutate(async () => {
      const code = randomHex(16);
      const expiresAt = Date.now() + TRANSFER_TTL_MS;
      const record: StoredTransfer = { clientId: profile.clientId, token: credentials.token, expiresAt };
      await this.ctx.storage.put(transferKey(code), record);
      return ok({ code, expiresAt });
    });
  }

  /**
   * Redeem a transfer code for the credentials it stands for.
   *
   * Deleted on the way through whatever happens next, because a code that
   * survived a failed claim would be a profile handed to whoever retried it.
   * Anybody holding the code gets the account, which is why it is short-lived
   * and why the link should be treated like a password.
   */
  async claimTransfer(
    rawCode: string,
  ): Promise<ProgressResult<{ identity: ProgressCredentials }>> {
    await this.ensureMigrations();
    const code = (rawCode ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(code)) return fail(400, 'That is not a transfer code');

    return this.mutate(async () => {
      const key = transferKey(code);
      const record = await this.ctx.storage.get<StoredTransfer>(key);
      if (!record) return fail<{ identity: ProgressCredentials }>(404, 'That link has already been used, or has expired');
      await this.ctx.storage.delete(key);

      if (record.expiresAt < Date.now()) {
        return fail<{ identity: ProgressCredentials }>(410, 'That link has expired');
      }
      const profile = await this.ctx.storage.get<StoredProfile>(profileKey(record.clientId));
      if (!profile) return fail<{ identity: ProgressCredentials }>(404, 'That profile no longer exists');

      return ok({ identity: { clientId: profile.clientId, token: record.token } });
    });
  }

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
      ranks: await this.allTimePlaces(profile.clientId),
    });
  }

  /**
   * Spin the wheel: coins in, gems out.
   *
   * The roll happens here because the prize is the whole point of the spin —
   * a client that picked its own segment would simply always pick fifty.
   */
  async spinWheel(
    credentials: ProgressCredentials,
    watchedAd = false,
  ): Promise<ProgressResult<WheelResult>> {
    return this.mutate(async () => {
      const profile = await this.authenticateRecord(credentials);
      if (!profile) return fail<WheelResult>(401, 'Your player session is no longer valid');

      // The day's free spin is taken first, so a player never pays while one is
      // still waiting — and the day is stamped rather than counted down, which
      // is what makes it survive a restart and refuse a second one.
      const today = utcDayKey();
      const free = profile.freeSpinDay !== today;
      // An advert is only worth offering once the free spin is gone, and only
      // while the day's allowance lasts.
      const byAd = !free && watchedAd && adSpinsLeftFor(profile) > 0;

      if (!free && !byAd && profile.coins < WHEEL_COST_COINS) {
        return fail<WheelResult>(400, 'Not enough coins for a spin');
      }

      // Where the roll fell, then where it actually pays: a wedge already
      // struck off slides the result right to the next one still standing,
      // which is what makes the rare prize get likelier every spin.
      const marked = profile.markedWedges ?? [];
      const landedOn = nextUnmarkedWedge(wheelWedgeAt(randomRoll(WHEEL_WEDGE_TOTAL)), marked);
      // Nothing left at all should be impossible — the board refills the moment
      // it empties below — but a spin that cannot pay is worse than one that
      // refills first, so treat it as a fresh board rather than an error.
      const wedgeIndex = landedOn === -1 ? wheelWedgeAt(randomRoll(WHEEL_WEDGE_TOTAL)) : landedOn;
      const wedge = WHEEL_WEDGES[wedgeIndex];

      const struck = landedOn === -1 ? [wedgeIndex] : [...marked, wedgeIndex];
      // Refill the moment the last wedge goes, so a player is never left with
      // a wheel that has nowhere to land and a button that does nothing.
      const refilled = struck.length >= WHEEL_WEDGES.length;
      profile.markedWedges = refilled ? [] : struck;

      if (free) {
        profile.freeSpinDay = today;
      } else if (byAd) {
        // Reset with the day, so yesterday's count never limits today.
        profile.adSpinsUsed = (profile.adSpinDay === today ? profile.adSpinsUsed ?? 0 : 0) + 1;
        profile.adSpinDay = today;
      } else {
        profile.coins -= WHEEL_COST_COINS;
      }
      profile.gems = (profile.gems ?? 0) + wedge.gems;
      profile.updatedAt = Date.now();
      await this.ctx.storage.put(profileKey(profile.clientId), profile);

      await this.count(`spin.${free ? 'free' : byAd ? 'ad' : 'coins'}`);
      if (wedge.rare) await this.count('spin.rare');
      return ok({
        gems: wedge.gems,
        free,
        source: free ? 'free' : byAd ? 'ad' : 'coins',
        wedge: wedgeIndex,
        refilled,
        profile: await this.view(profile),
      });
    });
  }

  /**
   * Pay for one power, now rather than when the game is claimed.
   *
   * A game can be abandoned and never claimed, so charging at the end would
   * hand out free powers to anyone who closed the tab.
   */
  /**
   * Put every wedge back.
   *
   * The rare prize is struck off like any other once it is won, so without
   * this a player who hit it could never hit it again. Resetting is always the
   * player's own choice: it trades the odds they have built up for the chance
   * to build them again, and only they can judge which they want.
   */
  async resetWheel(credentials: ProgressCredentials): Promise<ProgressResult<ProgressProfile>> {
    return this.mutate(async () => {
      const profile = await this.authenticateRecord(credentials);
      if (!profile) return fail<ProgressProfile>(401, 'Your player session is no longer valid');
      profile.markedWedges = [];
      profile.updatedAt = Date.now();
      await this.ctx.storage.put(profileKey(profile.clientId), profile);
      await this.count('spin.reset');
      return ok(await this.view(profile));
    });
  }

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
    ranked = false,
  ): Promise<ProgressResult<ClaimResult>> {
    return this.mutate(() => this.claimClassicLocked(credentials, seed, moves, ranked));
  }

  private async claimClassicLocked(
    credentials: ProgressCredentials,
    seed: number,
    moves: GameAction[],
    ranked: boolean,
  ): Promise<ProgressResult<ClaimResult>> {
    const profile = await this.authenticateRecord(credentials);
    if (!profile) return fail(401, 'Your player session is no longer valid');
    if (!validSeed(seed) || !Array.isArray(moves) || moves.length > MAX_CLASSIC_MOVES) {
      return fail(400, 'That game transcript is invalid');
    }
    if (!moves.every(validAction)) return fail(400, 'That game transcript is invalid');
    // Checked here rather than trusted from the client: a ranked run claiming a
    // power it was never allowed is refused outright, not quietly unranked.
    if (ranked && !isRankedTranscript(moves)) {
      return fail(400, 'A ranked game cannot use powers');
    }

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

    const fingerprint = await hashToken(JSON.stringify([seed, moves, ranked]));
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
    // Casual Classic is played for coins and your own best; only Ranked is a
    // ranking. Both still count toward the profile's lifetime totals.
    const ledger = ranked
      ? await this.rankedWrites(record)
      : { writes: {} as Record<string, RankedScore>, weeklyBest: false, windows: [] as string[] };

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
      ...ledger.writes,
      [profileKey(profile.clientId)]: profile,
      [claimKey]: { reward, weeklyBest: ledger.weeklyBest } satisfies StoredClaim,
    };
    await this.ctx.storage.put(writes);
    this.foldIntoBoards(record, ledger.windows);
    const weeklyBest = ledger.weeklyBest;

    await this.count(ranked ? 'classic.ranked' : 'classic.casual');
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
    let filed: { record: RankedScore; windows: string[] } | null = null;
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
      filed = { record, windows: ranked.windows };
    }

    writes[claimKey] = { reward, weeklyBest };
    await this.ctx.storage.put(writes);
    if (filed) this.foldIntoBoards(filed.record, filed.windows);
    await this.count(input.ranked ? 'duo.ranked' : 'duo.casual');
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
      this.boards.clear();
    });
  }

  /** Every repair the stored ledger might still need, in dependency order. */
  private async ensureMigrations(): Promise<void> {
    await this.backfillAllTime();
    await this.backfillStats();
  }

  /**
   * Who the rows being shown actually are, right now.
   *
   * Read every time rather than remembered, because a name is not fixed the
   * way a friend code is: a player renames and every board they are on has to
   * say so. It is one batched read of at most a hundred profiles per board,
   * which is what a leaderboard costs.
   */
  private async identitiesFor(
    clientIds: string[],
  ): Promise<Map<string, { friendCode: string; name: string }>> {
    const unique = [...new Set(clientIds)];
    const identities = new Map<string, { friendCode: string; name: string }>();

    // Durable Object storage reads at most 128 keys at a time.
    for (let i = 0; i < unique.length; i += MAX_PUT_KEYS) {
      const slice = unique.slice(i, i + MAX_PUT_KEYS);
      const found = await this.ctx.storage.get<StoredProfile>(slice.map(profileKey));
      for (const profile of found.values()) {
        if (!profile?.clientId) continue;
        identities.set(profile.clientId, {
          friendCode: profile.friendCode,
          name: cleanName(profile.name),
        });
      }
    }
    return identities;
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
      freeSpinAvailable: profile.freeSpinDay !== utcDayKey(),
      adSpinsLeft: adSpinsLeftFor(profile),
      markedWedges: profile.markedWedges ?? [],
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
  ): Promise<{ writes: Record<string, RankedScore>; weeklyBest: boolean; windows: string[] }> {
    const week = weekWindow(record.achievedAt);
    const writes: Record<string, RankedScore> = {};
    const windows: string[] = [];
    let weeklyBest = false;

    for (const window of [week.key, ALL_TIME]) {
      const key = scoreKey(window, record.mode, record.id);
      const previous = await this.ctx.storage.get<RankedScore>(key);
      if (!beats(record, previous)) continue;
      writes[key] = record;
      windows.push(window);
      if (window === week.key) weeklyBest = true;
    }

    return { writes, weeklyBest, windows };
  }

  /**
   * Fold a record that has just been filed into any board already in memory.
   *
   * The sorted scan is cached for a minute and this object is its only writer,
   * so keeping what is held in step costs one insert and spares the rescan. It
   * is also the difference between a player who has just finished a ranked game
   * reading their real place and reading the board from before they played —
   * which, on a profile, comes out as having no place at all.
   */
  private foldIntoBoards(record: RankedScore, windows: string[]): void {
    for (const window of windows) {
      const cached = this.boards.get(`${window}:${record.mode}`);
      if (!cached) continue;
      // Replaced rather than mutated: a reader part-way through a board holds
      // the array it started with, not one changing underneath it.
      const records = cached.records.filter((held) => held.id !== record.id);
      records.push(record);
      records.sort(compareScores);
      cached.records = records;
    }
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
      // Records changed underneath any board already held.
      this.boards.clear();
    });
  }
}

/** Advert spins left today, counting a stale day as a fresh allowance. */
function adSpinsLeftFor(profile: StoredProfile): number {
  const used = profile.adSpinDay === utcDayKey() ? profile.adSpinsUsed ?? 0 : 0;
  return Math.max(0, MAX_AD_SPINS_PER_DAY - used);
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

function transferKey(code: string) {
  return `transfer:${code}`;
}

function scorePrefix(window: string, mode: GameMode) {
  return `score:${window}:${mode}:`;
}

function scoreKey(window: string, mode: GameMode, id: string) {
  return `${scorePrefix(window, mode)}${id}`;
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
