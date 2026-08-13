import { useState } from 'react';
import { DUO_TURN_MS, isValidRoomCode, type DuoMode } from '@blokduo/engine';
import { unlockAudio } from '../audio/sfx';
import { apiUrl } from '../net/config';
import { loadDuoMode, loadName, saveDuoMode, saveName } from '../storage';

interface Props {
  onEnter: (code: string, name: string) => void;
  onHome: () => void;
}

const MODES: Array<{ mode: DuoMode; label: string; blurb: string; note: string }> = [
  {
    mode: 'classic',
    label: 'Classic Duo',
    blurb: 'A minute a turn. Talk it over, plan the clear.',
    note: 'Earns coins',
  },
  {
    mode: 'ranked',
    label: 'Ranked Duo',
    blurb: 'Five seconds a turn. Trust your gut.',
    note: 'Earns coins · counts for the leaderboards',
  },
];

const seconds = (mode: DuoMode) => Math.round(DUO_TURN_MS[mode] / 1000);

export function DuoLobby({ onEnter, onHome }: Props) {
  const [name, setName] = useState(() => loadName());
  const [mode, setMode] = useState<DuoMode>(loadDuoMode);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const displayName = name.trim() || 'Player';

  const chooseMode = (next: DuoMode) => {
    setMode(next);
    saveDuoMode(next);
  };

  const create = async () => {
    unlockAudio();
    setBusy('create');
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/room'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error('Could not create a room');
      const { code: fresh } = (await res.json()) as { code: string };
      saveName(displayName);
      onEnter(fresh, displayName);
    } catch {
      setError('Could not reach the game server. Is it running?');
      setBusy(null);
    }
  };

  const join = async () => {
    unlockAudio();
    const wanted = code.trim().toUpperCase();
    if (!isValidRoomCode(wanted)) {
      setError('Room codes are six letters and numbers.');
      return;
    }
    setBusy('join');
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/room/${wanted}`));
      const body = (await res.json()) as { exists?: boolean; open?: boolean };
      if (!res.ok || !body.exists) {
        setError('No game with that code.');
        setBusy(null);
        return;
      }
      if (!body.open) {
        setError('That game is already full.');
        setBusy(null);
        return;
      }
      saveName(displayName);
      onEnter(wanted, displayName);
    } catch {
      setError('Could not reach the game server.');
      setBusy(null);
    }
  };

  return (
    <div className="screen lobby">
      <header className="topbar">
        <button className="icon-btn" onClick={onHome} aria-label="Back to menu">
          ‹
        </button>
        <span className="topbar-title">Duo</span>
        <span className="topbar-spacer" />
      </header>

      <h2 className="lobby-title">Two players, one board</h2>
      <p className="lobby-sub">
        You take turns from the same three pieces. The piece you take is one your partner
        can&rsquo;t have — so set each other up.
      </p>

      <label className="field">
        <span>Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 20))}
          placeholder="Player"
          autoComplete="nickname"
        />
      </label>

      <fieldset className="mode-picker">
        <legend>Choose a mode</legend>
        {MODES.map((option) => (
          <label
            key={option.mode}
            className={`mode-card${mode === option.mode ? ' selected' : ''}`}
          >
            <input
              type="radio"
              name="duo-mode"
              value={option.mode}
              checked={mode === option.mode}
              onChange={() => chooseMode(option.mode)}
            />
            <span className="mode-body">
              <span className="mode-head">
                <strong>{option.label}</strong>
                <span className={`mode-clock ${option.mode}`}>{seconds(option.mode)}s</span>
              </span>
              <small>{option.blurb}</small>
              <small className="mode-note">{option.note}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <button className="btn primary big" onClick={create} disabled={busy !== null}>
        {busy === 'create' ? 'Creating…' : 'Create a room'}
        <span className="btn-sub">You&rsquo;ll get a code to share</span>
      </button>

      <div className="divider">
        <span>or join one</span>
      </div>

      <div className="join-row">
        <input
          className="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && join()}
          placeholder="ABC123"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Room code"
        />
        <button className="btn" onClick={join} disabled={busy !== null || code.length !== 6}>
          Join
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
