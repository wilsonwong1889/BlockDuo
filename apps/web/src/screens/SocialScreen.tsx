import { useEffect, useMemo, useState } from 'react';
import type {
  GameMode,
  LeaderboardScope,
  LeaderboardView,
} from '@blokduo/engine';
import { Leaderboard } from '../components/Leaderboard';
import { useProgress } from '../progress/ProgressContext';

interface Props {
  onHome: () => void;
  onPlayer: (friendCode: string) => void;
}

export function SocialScreen({ onHome, onPlayer }: Props) {
  const progress = useProgress();
  const [mode, setMode] = useState<GameMode>('classic');
  const [scope, setScope] = useState<LeaderboardScope>('global');
  const [board, setBoard] = useState<LeaderboardView | null>(null);
  const [name, setName] = useState(progress.profile?.name ?? '');
  const [friendCode, setFriendCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Kept apart from `message`: one is a notice about something you did, the
  // other is the board failing to load, and they belong in different places.
  const [boardError, setBoardError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (progress.profile) setName(progress.profile.name);
  }, [progress.profile]);

  useEffect(() => {
    let current = true;
    setBoard(null);
    setBoardError(null);
    void progress
      .leaderboard(mode, scope)
      .then((next) => current && setBoard(next))
      .catch((error: unknown) => current && setBoardError(errorMessage(error)));
    return () => {
      current = false;
    };
  }, [mode, scope, reloadKey, progress.leaderboard, progress.profile?.clientId]);

  const resetLabel = useMemo(
    () =>
      board
        ? new Intl.DateTimeFormat(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'UTC',
            timeZoneName: 'short',
          }).format(board.week.end)
        : '',
    [board],
  );

  const saveProfile = async () => {
    setBusy('name');
    setMessage(null);
    try {
      await progress.rename(name);
      setMessage('Name updated');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    setBusy('friend');
    setMessage(null);
    try {
      await progress.addFriend(friendCode);
      setFriendCode('');
      setScope('friends');
      setBoard(await progress.leaderboard(mode, 'friends'));
      setMessage('Friend added — you now appear on each other’s friends board');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (code: string) => {
    setBusy(code);
    setMessage(null);
    try {
      await progress.removeFriend(code);
      setBoard(await progress.leaderboard(mode, scope));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const copyCode = async () => {
    if (!progress.profile) return;
    try {
      await navigator.clipboard.writeText(progress.profile.friendCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setMessage('Press and hold the code to copy it');
    }
  };

  return (
    <div className="screen social-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onHome} aria-label="Back to menu">
          ‹
        </button>
        <span className="topbar-title">Leaderboard</span>
        <div className="coin-pill">◆ {progress.profile?.coins.toLocaleString() ?? '—'}</div>
      </header>

      <section className="social-card profile-card">
        <div>
          <span className="eyebrow">Player profile</span>
          <div className="profile-code">{progress.profile?.friendCode ?? 'Connecting…'}</div>
        </div>
        <button className="btn compact" onClick={copyCode} disabled={!progress.profile}>
          {copied ? 'Copied' : 'Copy code'}
        </button>

        <div className="profile-name-row">
          <input
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 20))}
            onKeyDown={(event) => event.key === 'Enter' && void saveProfile()}
            aria-label="Display name"
            placeholder="Player"
          />
          <button className="btn compact" onClick={saveProfile} disabled={busy !== null}>
            Save
          </button>
        </div>
      </section>

      <section className="social-card">
        <span className="eyebrow">Add a friend</span>
        <div className="join-row">
          <input
            className="friend-code-input"
            value={friendCode}
            onChange={(event) => setFriendCode(event.target.value.toUpperCase().slice(0, 11))}
            onKeyDown={(event) => event.key === 'Enter' && void add()}
            placeholder="BD-ABCDEFGH"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Friend code"
          />
          <button className="btn compact" onClick={add} disabled={busy !== null || friendCode.length < 8}>
            Add
          </button>
        </div>

        {!!progress.profile?.friends.length && (
          <div className="friend-list">
            {progress.profile.friends.map((friend) => (
              <div className="friend-row" key={friend.friendCode}>
                <span className="friend-identity">
                  <strong>{friend.name}</strong>
                  <small>{friend.friendCode}</small>
                </span>
                <button
                  type="button"
                  className="view-profile"
                  onClick={() => onPlayer(friend.friendCode)}
                  aria-label={`View ${friend.name}'s profile`}
                >
                  View profile
                </button>
                <button
                  className="link-btn danger-link"
                  onClick={() => void remove(friend.friendCode)}
                  disabled={busy !== null}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {message && (
        <p className="social-message" role="status">
          {message}
        </p>
      )}

      <section className="leaderboard-card">
        <div className="segmented" aria-label="Leaderboard mode">
          <button className={mode === 'classic' ? 'active' : ''} onClick={() => setMode('classic')}>
            Ranked Classic
          </button>
          <button className={mode === 'duo' ? 'active' : ''} onClick={() => setMode('duo')}>
            Duo teams
          </button>
        </div>
        <div className="segmented subtle" aria-label="Leaderboard scope">
          <button className={scope === 'global' ? 'active' : ''} onClick={() => setScope('global')}>
            Global
          </button>
          <button className={scope === 'friends' ? 'active' : ''} onClick={() => setScope('friends')}>
            Friends
          </button>
        </div>

        <p className="board-note">
          {mode === 'duo'
            ? 'Only Ranked Duo rooms are scored here. Updates every minute.'
            : 'Only Ranked Classic games are scored here. Updates every minute.'}
        </p>

        <Leaderboard
          title="All time"
          subtitle="Every week that has ever been played"
          board={board?.allTime ?? null}
          onPlayer={onPlayer}
          loading={!board && !boardError}
          error={boardError}
          onRetry={() => setReloadKey((n) => n + 1)}
          emptyText={
            scope === 'friends'
              ? 'No friend has finished this mode yet.'
              : 'Nobody has finished this mode yet. Go first.'
          }
        />

        <Leaderboard
          title="This week"
          subtitle={resetLabel ? `Resets ${resetLabel}` : 'Loading this week…'}
          board={board?.weekly ?? null}
          onPlayer={onPlayer}
          loading={!board && !boardError}
          error={boardError}
          onRetry={() => setReloadKey((n) => n + 1)}
          emptyText={
            scope === 'friends'
              ? 'No friend has finished this mode this week yet.'
              : 'Be the first score on this week’s board.'
          }
        />
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}
