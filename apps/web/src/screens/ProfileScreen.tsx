import { useEffect, useState } from 'react';
import {
  ALL_TIME_LEADERBOARD_SIZE,
  averageGameScore,
  type LeaderboardPlaces,
  type PublicProfile,
} from '@blokduo/engine';
import { SettingsPanel } from '../components/SettingsPanel';
import { updateAppSettings } from '../preferences';
import { fetchPublicProfile } from '../progress/api';
import { useProgress } from '../progress/ProgressContext';
import { loadAppSettings, type AppSettings } from '../storage';
import { timeAgo } from '../time';

interface Props {
  /** A friend code, or null for "whoever is playing on this device". */
  code: string | null;
  onHome: () => void;
}

const joinedLabel = (at: number) =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(at);

/**
 * The all-time places worth drawing, in board order.
 *
 * A mode with no ranked score in it is dropped rather than shown as a dash: a
 * player who has only ever played Duo has no Classic place, which is not the
 * same as being last in it.
 */
const placeRows = (ranks: LeaderboardPlaces | undefined) =>
  [
    { label: 'Ranked Classic', place: ranks?.classic ?? null },
    { label: 'Duo teams', place: ranks?.duo ?? null },
  ].filter((row): row is { label: string; place: number } => row.place !== null);

export function ProfileScreen({ code, onHome }: Props) {
  const { profile: me } = useProgress();
  // Your own profile is read through the same public endpoint as anyone else's,
  // so there is one code path and one set of numbers rather than two that can
  // disagree about what you have done.
  const wanted = code ?? me?.friendCode ?? null;
  const isMe = !!wanted && wanted === me?.friendCode;

  const [player, setPlayer] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState(loadAppSettings);
  const [showSettings, setShowSettings] = useState(false);

  const changeSettings = (next: AppSettings) => {
    setSettings(next);
    updateAppSettings(next);
  };

  useEffect(() => {
    if (!wanted) return;
    let current = true;
    setPlayer(null);
    setError(null);
    fetchPublicProfile(wanted)
      .then((next) => current && setPlayer(next))
      .catch((cause: unknown) =>
        current && setError(cause instanceof Error ? cause.message : 'Could not load that player'),
      );
    return () => {
      current = false;
    };
  }, [wanted]);

  const share = async () => {
    if (!player) return;
    const url = `${window.location.origin}/#/player/${player.friendCode}`;
    try {
      if (navigator.share) await navigator.share({ title: 'BLOKDUO', text: player.name, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      /* the player dismissed the sheet */
    }
  };

  const stats = player?.stats;
  const places = placeRows(player?.ranks);
  // A zero is dropped rather than shown, because for a player who was here
  // before totals were counted it means "not known" and not "none" — and an
  // average of 0 printed beside a best game of 345 just reads as broken. Games
  // played always shows: it is the one total that was always recorded.
  const rows = (
    stats
      ? [
          { label: 'Games played', value: stats.gamesPlayed, always: true },
          { label: 'Best game', value: stats.bestScore },
          { label: 'Average score', value: averageGameScore(stats) },
          { label: 'Best streak', value: stats.bestStreak },
          { label: 'Lines cleared', value: stats.totalLines },
          { label: 'Classic games', value: stats.classicGames },
          { label: 'Duo games', value: stats.duoGames },
          { label: 'Coins earned', value: stats.coins },
        ]
      : []
  ).filter((row) => row.always || row.value > 0);

  return (
    <div className="screen social-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onHome} aria-label="Back to menu">
          ‹
        </button>
        <span className="topbar-title">{isMe ? 'Your profile' : 'Profile'}</span>
        <span className="topbar-spacer" />
      </header>

      {!wanted && <p className="empty-board">Connecting…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {wanted && !player && !error && <p className="empty-board">Loading profile…</p>}

      {player && (
        <>
          <section className="social-card profile-card">
            <div>
              <span className="eyebrow">{isMe ? 'You' : 'Player'}</span>
              <div className="profile-display-name">{player.name}</div>
              <div className="profile-code">{player.friendCode}</div>
              <small className="profile-since">
                Playing since {joinedLabel(player.joinedAt)}
                {player.stats.lastPlayedAt !== null && (
                  <> · last played {timeAgo(player.stats.lastPlayedAt)}</>
                )}
              </small>
            </div>
            <button className="btn compact" onClick={share}>
              {copied ? 'Link copied' : 'Share'}
            </button>
          </section>

          {isMe && (
            <section className="leaderboard-card">
              <div className="leaderboard-heading">
                <div>
                  <h2>Settings</h2>
                  <p>Sound, haptics and motion, on this device.</p>
                </div>
                <button className="btn compact" onClick={() => setShowSettings(true)}>
                  Open
                </button>
              </div>
              <div className="settings-summary">
                <span>Sound {settings.sound ? 'on' : 'off'}</span>
                <span aria-hidden>·</span>
                <span>Haptics {settings.haptics ? 'on' : 'off'}</span>
              </div>
            </section>
          )}

          <section className="leaderboard-card">
            <div className="leaderboard-heading">
              <div>
                <h2>Ranked place</h2>
                <p>
                  Across every ranked score ever set, not just the top{' '}
                  {ALL_TIME_LEADERBOARD_SIZE} the board shows.
                </p>
              </div>
            </div>

            {places.length === 0 ? (
              <p className="empty-board">
                {isMe
                  ? 'Finish a Ranked game to take a place on the all-time board.'
                  : 'No ranked game yet, so no place on the all-time board.'}
              </p>
            ) : (
              <div className="lifetime-stat-grid">
                {places.map((row) => (
                  <div className="lifetime-stat" key={row.label}>
                    <strong>#{row.place.toLocaleString()}</strong>
                    <span>{row.label}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="leaderboard-card">
            <div className="leaderboard-heading">
              <div>
                <h2>Lifetime</h2>
                <p>Counted by the server from finished games.</p>
              </div>
            </div>

            {stats?.gamesPlayed === 0 ? (
              <p className="empty-board">
                {isMe ? 'Finish a game to start your record.' : 'No finished games yet.'}
              </p>
            ) : (
              <div className="lifetime-stat-grid">
                {rows.map((row) => (
                  <div className="lifetime-stat" key={row.label}>
                    <strong>{row.value.toLocaleString()}</strong>
                    <span>{row.label}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={changeSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
