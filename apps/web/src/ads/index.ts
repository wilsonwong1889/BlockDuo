/**
 * Rewarded adverts — the seam, without an advert behind it yet.
 *
 * Everything that offers a reward for watching goes through `showRewardedAd`,
 * so when a network is added there is exactly one function to replace and no
 * screen to revisit. Until then it resolves as though a placeholder was
 * watched, which lets the whole flow — the quota, the reward, the refusals —
 * be built and tested before any ad code exists.
 *
 * The shape is deliberately the one every rewarded SDK has: an async call that
 * resolves once the advert is finished, and can report that it was not.
 */

export type AdPlacement = 'wheel-spin';

export interface AdResult {
  /** False when the advert was dismissed early, failed to load, or was blocked. */
  watched: boolean;
  /**
   * A network's server-to-server verification token, when it has one.
   *
   * Empty today. It is threaded through to the server now so that turning on
   * real adverts is a change to this file and a check on the server, rather
   * than a change to the reward endpoints and everything that calls them.
   */
  token: string;
}

/** How long the placeholder pretends to be an advert. */
const PLACEHOLDER_MS = 900;

let provider: (placement: AdPlacement) => Promise<AdResult> = async () => {
  await new Promise((resolve) => setTimeout(resolve, PLACEHOLDER_MS));
  return { watched: true, token: '' };
};

/** Swap in a real network. Called once at startup when there is one. */
export function setAdProvider(next: (placement: AdPlacement) => Promise<AdResult>) {
  provider = next;
}

/** True once a real network is wired up, for copy that should not lie. */
export let adsAreLive = false;

export function markAdsLive(live: boolean) {
  adsAreLive = live;
}

export async function showRewardedAd(placement: AdPlacement): Promise<AdResult> {
  try {
    return await provider(placement);
  } catch {
    // A network that throws is a network that did not show an advert. The
    // player keeps whatever they had rather than being charged for nothing.
    return { watched: false, token: '' };
  }
}
