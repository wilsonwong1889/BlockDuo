import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_DUO_MODE, DUO_TURN_MS, isDuoMode, type DuoMode } from '@blokduo/engine';
import { Board } from '../components/Board';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DragLayer } from '../components/DragLayer';
import { GameOver } from '../components/GameOver';
import { Hud } from '../components/Hud';
import { Tray } from '../components/Tray';
import { TurnTimer } from '../components/TurnTimer';
import { useDuoGame } from '../game/useDuoGame';
import { useGeometry, usePlacement } from '../game/usePlacement';
import { useBackHandler } from '../native/useBackHandler';
import { inviteUrl } from '../net/config';

interface Props {
  code: string;
  name: string;
  onHome: () => void;
}

export function DuoScreen({ code, name, onHome }: Props) {
  const { geom, boardRef, measureNow } = useGeometry();
  const duo = useDuoGame(code, name);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const placement = usePlacement(
    duo.state?.board ?? EMPTY_BOARD,
    duo.state?.hand ?? EMPTY_HAND,
    geom,
    duo.commit,
    duo.reject,
    duo.myTurn,
    measureNow,
  );

  const snapshot = duo.snapshot;
  const me = duo.seat !== null ? snapshot?.players[duo.seat] ?? null : null;
  const partnerSeat = duo.seat === 0 ? 1 : 0;
  const partner = snapshot?.players[partnerSeat] ?? null;
  // A joiner inherits the host's choice, so the room is the authority on it.
  const mode: DuoMode = isDuoMode(snapshot?.mode) ? snapshot.mode : DEFAULT_DUO_MODE;

  const requestLeave = useCallback(() => {
    if (snapshot && snapshot.phase !== 'over') setConfirmLeave(true);
    else onHome();
  }, [onHome, snapshot]);

  // Back out of a live room asks first, the same as the header button. A dialog
  // open over this screen registered later, so it answers back before we do.
  useBackHandler(() => {
    requestLeave();
    return true;
  });

  const share = async () => {
    const url = inviteUrl(code);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'BLOKDUO', text: `Join my game: ${code}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // The player dismissed the share sheet, or the clipboard was refused.
    }
  };

  const turnLabel = useMemo(() => {
    if (duo.status === 'connecting') return 'Connecting…';
    if (duo.status === 'reconnecting') return 'Reconnecting…';
    if (!snapshot) return '';
    if (snapshot.phase === 'waiting') return 'Waiting for a second player';
    if (snapshot.phase === 'over') return 'Game over';
    return duo.myTurn ? 'Your turn' : `${partner?.name ?? 'Partner'}'s turn`;
  }, [duo.status, duo.myTurn, snapshot, partner]);

  const localDeadline = useMemo(
    () =>
      snapshot?.deadline
        ? Date.now() + Math.max(0, snapshot.deadline - snapshot.serverNow)
        : null,
    [snapshot?.deadline, snapshot?.serverNow],
  );

  if (!duo.state || !snapshot) {
    return (
      <div className="screen duo">
        <header className="topbar">
          <button className="icon-btn" onClick={requestLeave} aria-label="Leave game">
            ‹
          </button>
          <span className="topbar-title">Room {code}</span>
          <span className="topbar-spacer" />
        </header>
        <p className="lobby-sub">{duo.error ?? 'Connecting to the room…'}</p>
        {duo.error && (
          <button className="btn" onClick={onHome}>
            Back
          </button>
        )}
      </div>
    );
  }

  const waiting = snapshot.phase === 'waiting';

  return (
    <div className="screen duo">
      <header className="topbar">
        <button className="icon-btn" onClick={requestLeave} aria-label="Leave game">
          ‹
        </button>
        <button className="room-code" onClick={share} title="Share this room">
          {code}
          <span className="room-code-hint">{copied ? 'Link copied' : 'tap to share'}</span>
        </button>
        <span className={`mode-badge ${mode}`} title={`${DUO_TURN_MS[mode] / 1000}s a turn`}>
          {mode === 'ranked' ? 'Ranked' : 'Classic'}
        </span>
      </header>

      <div className="players">
        {[0, 1].map((index) => {
          const player = snapshot.players[index];
          const active = snapshot.phase === 'playing' && snapshot.turn === index;
          return (
            <div
              key={index}
              className={[
                'player',
                active ? 'active' : '',
                index === duo.seat ? 'me' : '',
                player && !player.connected ? 'away' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="player-name">
                {player ? player.name : 'Empty seat'}
                {index === duo.seat && ' (you)'}
              </span>
              <span className="player-stat">
                {player ? `${player.placements} pieces · ${player.linesCleared} lines` : '—'}
                {player && !player.connected && ' · away'}
              </span>
            </div>
          );
        })}
      </div>

      <Hud
        score={duo.state.score}
        streak={duo.state.streak}
        label="Team score"
      />

      <div className={`turn-banner${duo.myTurn ? ' mine' : ''}`} aria-live="polite">
        <span>{duo.lastEvent ?? turnLabel}</span>
        {localDeadline !== null && snapshot.phase === 'playing' && (
          <TurnTimer deadline={localDeadline} turnMs={DUO_TURN_MS[mode]} />
        )}
      </div>

      <div className="board-wrap">
        <Board
          ref={boardRef}
          board={duo.state.board}
          geom={geom}
          preview={placement.preview}
          clearFx={duo.clearFx}
          floats={duo.floats}
          shake={duo.shake}
          onCellEnter={placement.selected !== null ? placement.setCursor : undefined}
          onCellClick={placement.selected !== null ? placement.placeAtCursor : undefined}
          dimmed={!duo.myTurn}
          dragging={placement.drag !== null}
        />
      </div>

      <Tray
        hand={duo.state.hand}
        board={duo.state.board}
        boardStride={geom.stride}
        gap={geom.gap}
        selected={placement.selected}
        draggingSlot={placement.drag?.slot ?? null}
        disabled={!duo.myTurn}
        onStart={placement.startDrag}
        onSelect={placement.toggleSelect}
      />

      <DragLayer
        drag={placement.drag}
        geom={geom}
        valid={placement.preview?.valid ?? false}
        positionRef={placement.dragPositionRef}
      />

      {waiting && (
        <div className="overlay">
          <div className="panel">
            <h2 className="panel-title">Room code</h2>
            <div className="big-code">{code}</div>
            <p className="panel-note">
              Send this to whoever you&rsquo;re playing with. The game starts the moment they
              arrive.
            </p>
            <div className="panel-actions">
              <button className="btn primary" onClick={share}>
                {copied ? 'Link copied' : 'Share invite link'}
              </button>
              <button className="btn" onClick={requestLeave}>
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {snapshot.phase === 'over' && (
        <GameOver
          title={snapshot.result?.kind === 'timeout' ? 'Round timed out' : 'No moves left'}
          score={duo.state.score}
          note={
            snapshot.result?.kind === 'timeout'
              ? 'The round ended after repeated timeouts, so it does not earn coins or a rank.'
              : me && partner
              ? `${contributionLine(me.cellsPlaced, partner.cellsPlaced, me.name, partner.name)}`
              : undefined
          }
          stats={[
            { label: 'Lines', value: duo.state.linesCleared },
            { label: 'Pieces', value: duo.state.moveCount },
            { label: 'Best streak', value: duo.state.bestStreak },
          ]}
          reward={snapshot.result?.reward}
          rewardStatus={
            snapshot.result?.reward
              ? snapshot.result.settled
                ? 'awarded'
                : 'pending'
              : null
          }
          primaryLabel={me?.ready ? 'Waiting for partner…' : 'Rematch'}
          onPrimary={duo.rematch}
          onHome={onHome}
        />
      )}

      {confirmLeave && (
        <ConfirmDialog
          title="Leave Duo game?"
          message="Leaving may make your partner wait while the room holds your place."
          confirmLabel="Leave game"
          danger
          onConfirm={onHome}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}

function contributionLine(mine: number, theirs: number, myName: string, theirName: string): string {
  const total = mine + theirs;
  if (total === 0) return 'Nobody placed a thing.';
  const pct = Math.round((mine / total) * 100);
  return `${myName} placed ${pct}% of the blocks, ${theirName} the other ${100 - pct}%.`;
}

const EMPTY_BOARD = new Uint8Array(64);
const EMPTY_HAND = [null, null, null];
