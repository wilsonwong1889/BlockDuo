import { useState } from 'react';
import type { POWER_COSTS, PowerName } from '@blokduo/engine';

interface Props {
  gems: number;
  costs: typeof POWER_COSTS;
  canUndo: boolean;
  undosLeft: number;
  /** Which tray slot a rotation would turn, or null when nothing is chosen. */
  selectedSlot: number | null;
  disabled: boolean;
  onUse: (power: PowerName, slot?: number) => Promise<boolean>;
}

export function PowerBar({
  gems,
  costs,
  canUndo,
  undosLeft,
  selectedSlot,
  disabled,
  onUse,
}: Props) {
  const [busy, setBusy] = useState<PowerName | null>(null);

  const use = async (power: PowerName, slot?: number) => {
    if (busy) return;
    setBusy(power);
    try {
      await onUse(power, slot);
    } finally {
      setBusy(null);
    }
  };

  const affordable = (power: PowerName) => gems >= costs[power];

  return (
    <div className="power-bar" aria-label="Powers">
      <span className="gem-pill" title="Gems">
        ◈ {gems.toLocaleString()}
      </span>

      <button
        className="power"
        disabled={disabled || !!busy || !canUndo || !affordable('undo')}
        onClick={() => void use('undo')}
        aria-label={`Undo the last piece for ${costs.undo} gems, ${undosLeft} left this game`}
      >
        <span className="power-name">Undo</span>
        <span className="power-cost">◈{costs.undo}</span>
        <span className="power-note">{undosLeft} left</span>
      </button>

      <button
        className="power"
        disabled={disabled || !!busy || selectedSlot === null || !affordable('rotate')}
        onClick={() => selectedSlot !== null && void use('rotate', selectedSlot)}
        aria-label={`Turn the selected piece for ${costs.rotate} gems`}
      >
        <span className="power-name">Turn</span>
        <span className="power-cost">◈{costs.rotate}</span>
        {/* The rotate button acts on a piece, so it has to say which one. */}
        <span className="power-note">{selectedSlot === null ? 'pick one' : 'selected'}</span>
      </button>

      <button
        className="power"
        disabled={disabled || !!busy || !affordable('reroll')}
        onClick={() => void use('reroll')}
        aria-label={`Deal a new tray for ${costs.reroll} gems`}
      >
        <span className="power-name">New tray</span>
        <span className="power-cost">◈{costs.reroll}</span>
        <span className="power-note">all three</span>
      </button>
    </div>
  );
}
