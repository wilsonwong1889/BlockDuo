import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  ClaimResult,
  GameAction,
  GameMode,
  LeaderboardScope,
  LeaderboardView,
  Move,
  PowerName,
  ProgressProfile,
  WheelResult,
} from '@blokduo/engine';
import {
  loadName,
  loadPendingClassic,
  queuePendingClassic,
  removePendingClassic,
  saveName,
} from '../storage';
import {
  addFriend as addFriendRequest,
  announceProgressChange,
  claimClassic as claimClassicRequest,
  spendGems as spendGemsRequest,
  spinWheel as spinWheelRequest,
  fetchLeaderboard,
  fetchProfile,
  removeFriend as removeFriendRequest,
} from './api';
import { shouldDiscardPendingClassic } from './retryPolicy';

interface ProgressContextValue {
  profile: ProgressProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<ProgressProfile | null>;
  rename: (name: string) => Promise<ProgressProfile>;
  addFriend: (friendCode: string) => Promise<ProgressProfile>;
  removeFriend: (friendCode: string) => Promise<ProgressProfile>;
  leaderboard: (mode: GameMode, scope: LeaderboardScope) => Promise<LeaderboardView>;
  claimClassic: (seed: number, moves: GameAction[], ranked?: boolean) => Promise<ClaimResult | null>;
  /** Pay for a power. Resolves false when the gems were not there. */
  spendGems: (power: PowerName) => Promise<boolean>;
  spinWheel: (watchedAd?: boolean) => Promise<WheelResult>;
}

const ProgressContext = createContext<ProgressContextValue | null>(null);

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<ProgressProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<ProgressProfile | null> => {
    try {
      const next = await fetchProfile(loadName() || 'Player');
      setProfile(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Progress is temporarily unavailable');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const flushPending = useCallback(async () => {
    for (const pending of loadPendingClassic()) {
      try {
        const result = await claimClassicRequest(pending.seed, pending.moves, pending.ranked === true);
        removePendingClassic(pending);
        setProfile(result.profile);
      } catch (error) {
        // A rejected legacy transcript cannot become valid by retrying. Keep a
        // version-tagged one across a temporary Worker rollback, though: an
        // older verifier does not understand its opening-hand rules yet.
        if (
          error instanceof Error &&
          'status' in error &&
          typeof error.status === 'number' &&
          shouldDiscardPendingClassic(pending.seed, error.status)
        ) {
          removePendingClassic(pending);
          continue;
        }
        // Continue so one retryable claim never blocks later completed games.
        if (
          error instanceof Error &&
          'status' in error &&
          typeof error.status === 'number' &&
          error.status >= 400 &&
          error.status < 500
        ) {
          continue;
        }
        break;
      }
    }
  }, []);

  useEffect(() => {
    void refresh().then(() => flushPending());
    const onChange = () => void refresh();
    const onOnline = () => void flushPending().then(() => refresh());
    window.addEventListener('blokduo:progress-change', onChange);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onOnline);
    return () => {
      window.removeEventListener('blokduo:progress-change', onChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onOnline);
    };
  }, [flushPending, refresh]);

  const rename = useCallback(async (name: string) => {
    const clean = name.trim().slice(0, 20) || 'Player';
    saveName(clean);
    const next = await fetchProfile(clean);
    setProfile(next);
    return next;
  }, []);

  const addFriend = useCallback(async (friendCode: string) => {
    const next = await addFriendRequest(friendCode);
    setProfile(next);
    return next;
  }, []);

  const removeFriend = useCallback(async (friendCode: string) => {
    const next = await removeFriendRequest(friendCode);
    setProfile(next);
    return next;
  }, []);

  const leaderboard = useCallback(
    (mode: GameMode, scope: LeaderboardScope) => fetchLeaderboard(mode, scope),
    [],
  );

  const claimClassic = useCallback(async (seed: number, moves: GameAction[], ranked = false) => {
    const pending = { seed, moves };
    // Persist before the request: closing the tab during a slow response must
    // not lose a completed game's reward transcript.
    queuePendingClassic(pending);
    try {
      const result = await claimClassicRequest(seed, moves, ranked);
      removePendingClassic(pending);
      setProfile(result.profile);
      announceProgressChange();
      return result;
    } catch {
      return null;
    }
  }, []);

  const spendGems = useCallback(async (power: PowerName) => {
    try {
      setProfile(await spendGemsRequest(power));
      return true;
    } catch {
      // Out of gems, or offline. The caller simply does not get the power.
      return false;
    }
  }, []);

  const spinWheel = useCallback(async (watchedAd = false) => {
    const result = await spinWheelRequest(watchedAd);
    setProfile(result.profile);
    return result;
  }, []);

  const value = useMemo<ProgressContextValue>(
    () => ({
      profile,
      loading,
      error,
      refresh,
      rename,
      addFriend,
      removeFriend,
      leaderboard,
      claimClassic,
      spendGems,
      spinWheel,
    }),
    [profile, loading, error, refresh, rename, addFriend, removeFriend, leaderboard, claimClassic, spendGems, spinWheel],
  );

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressContextValue {
  const value = useContext(ProgressContext);
  if (!value) throw new Error('useProgress must be used inside ProgressProvider');
  return value;
}
