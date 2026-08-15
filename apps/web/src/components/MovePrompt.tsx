import { useState } from 'react';
import { isLegacyOrigin, transferUrl } from '../net/config';
import { createTransfer } from '../progress/api';

/**
 * The offer to carry a profile to the new domain, shown only on the old one.
 *
 * The game still answers on its workers.dev address so that invite links handed
 * out before blokduo.ca existed keep working — which means players can still
 * arrive here, and anybody who does would otherwise be handed a fresh empty
 * profile the first time they tried the new address.
 *
 * Never rendered in the native shell or on the canonical domain: there is
 * nowhere to move to from either.
 */
export function MovePrompt() {
  const [visible] = useState(() => isLegacyOrigin());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!visible) return null;

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      const { code } = await createTransfer();
      // Replace rather than open: one tab, and the spent code does not stay in
      // the history of the tab that minted it.
      window.location.href = transferUrl(code);
    } catch {
      setBusy(false);
      setError('Could not start the move. Try again in a moment.');
    }
  };

  return (
    <aside className="move-prompt">
      <p className="move-prompt-title">BLOKDUO now lives at blokduo.ca</p>
      <p className="move-prompt-body">
        This address keeps working, but your coins and stats are saved per address. Move them
        across and carry on there.
      </p>
      <button className="btn" onClick={move} disabled={busy}>
        {busy ? 'Moving…' : 'Move my progress →'}
      </button>
      {error && <p className="move-prompt-error">{error}</p>}
    </aside>
  );
}
