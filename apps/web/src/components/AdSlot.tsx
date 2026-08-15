import { useEffect, useRef, useState } from 'react';
import { adsenseClient, adsenseEnabled, fillSlot, loadAdsense } from '../ads/adsense';

interface Props {
  /** The slot ID from the AdSense dashboard, for this unit. */
  slot: string;
  /**
   * Label read by screen readers, since an advert is not part of the game and
   * should not be mistaken for it.
   */
  label?: string;
}

/**
 * One AdSense display unit.
 *
 * Renders nothing at all when adverts are off — not an empty container, not a
 * reserved gap. A site without a publisher ID should look like a site that was
 * never going to show adverts, and the native build must show none regardless.
 *
 * Placement is a policy matter as much as a design one: Google treats adverts
 * that sit close enough to controls to be tapped by accident as invalid
 * traffic, so these belong on menus and result screens, never beside the board
 * during play.
 */
export function AdSlot({ slot, label = 'Advertisement' }: Props) {
  const [enabled] = useState(() => adsenseEnabled());
  const ref = useRef<HTMLModElement>(null);
  const filled = useRef(false);

  useEffect(() => {
    if (!enabled || filled.current) return;
    if (!loadAdsense()) return;
    // Once per element: AdSense throws on a second push into the same slot,
    // which StrictMode's double mount would otherwise cause in development.
    filled.current = true;
    fillSlot();
  }, [enabled]);

  if (!enabled) return null;

  return (
    <aside className="ad-slot" aria-label={label}>
      <ins
        ref={ref}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={adsenseClient() ?? undefined}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
