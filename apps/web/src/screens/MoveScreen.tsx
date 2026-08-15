import { useEffect, useRef, useState } from 'react';
import { claimTransfer } from '../progress/api';
import { announceProgressChange } from '../progress/api';

interface Props {
  code: string | null;
  onHome: () => void;
}

type State =
  | { phase: 'working' }
  | { phase: 'done' }
  | { phase: 'failed'; message: string };

/**
 * The far end of a transfer link.
 *
 * Claims once and only once: the code is spent on the server the first time it
 * is read, so a retry — or React mounting this twice in development — would
 * report a failure for a transfer that in fact succeeded.
 */
export function MoveScreen({ code, onHome }: Props) {
  const [state, setState] = useState<State>({ phase: 'working' });
  const claimed = useRef(false);

  useEffect(() => {
    if (claimed.current) return;
    claimed.current = true;

    // Spend the code out of the URL as well as on the server. It is used up
    // either way by the time this runs, so leaving it in the address bar means
    // a reload retries a claim that can now only fail — telling somebody whose
    // move succeeded that it did not. replaceState rather than a route change,
    // so the result on screen survives.
    window.history.replaceState(null, '', `${window.location.pathname}#/`);

    if (!code) {
      setState({ phase: 'failed', message: 'That link is missing its transfer code.' });
      return;
    }

    let live = true;
    claimTransfer(code)
      .then(() => {
        if (!live) return;
        // Every screen reading progress is now reading a different profile.
        announceProgressChange();
        setState({ phase: 'done' });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setState({
          phase: 'failed',
          message:
            error instanceof Error
              ? error.message
              : 'That transfer link could not be used.',
        });
      });
    return () => {
      live = false;
    };
  }, [code]);

  return (
    <div className="screen move-screen">
      <h1 className="move-title">
        {state.phase === 'working' && 'Moving your progress…'}
        {state.phase === 'done' && 'Welcome back'}
        {state.phase === 'failed' && 'That link did not work'}
      </h1>

      {state.phase === 'done' && (
        <p className="move-body">
          Your coins, gems and stats have come with you. This is your account on blokduo.ca
          now — the old address still works, and both lead to the same progress.
        </p>
      )}

      {state.phase === 'failed' && (
        <>
          <p className="move-body">{state.message}</p>
          <p className="move-body muted">
            Transfer links can only be used once, and expire after fifteen minutes. Open the
            game on the old address and make a new one.
          </p>
        </>
      )}

      {state.phase !== 'working' && (
        <button className="btn primary big" onClick={onHome}>
          {state.phase === 'done' ? 'Play' : 'Continue anyway'}
        </button>
      )}
    </div>
  );
}
