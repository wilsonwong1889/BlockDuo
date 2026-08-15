/**
 * Google AdSense — display advertising on the website only.
 *
 * Separate from [`showRewardedAd`](./index.ts), and deliberately so: AdSense
 * has no rewarded format. Rewarded video is a mobile-app product (AdMob), so
 * the seam next door stays on its placeholder until a network that offers it
 * is wired up. This file is display banners on the web, nothing more.
 *
 * Nothing loads unless a publisher ID is configured, which keeps the site free
 * of third-party script until there is an approved account behind it — and
 * keeps development, tests and the native build clean by default.
 */

import { isNative } from '../native';

/** The shape Google issues: `ca-pub-` and sixteen digits. */
const CLIENT_PATTERN = /^ca-pub-\d{16}$/;

/**
 * Read a publisher ID, rejecting anything that is not one.
 *
 * Pure and exported for the tests: a typo in an environment variable should
 * mean no adverts, never a broken script tag on a live page.
 */
export function adsenseClientFrom(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  return CLIENT_PATTERN.test(value) ? value : null;
}

/** The configured publisher ID, or null when there is not a valid one. */
export function adsenseClient(): string | null {
  return adsenseClientFrom(import.meta.env.VITE_ADSENSE_CLIENT);
}

/**
 * Whether adverts should run at all.
 *
 * Never inside the native shell. AdSense is for websites; serving it in an app
 * webview breaks Google's programme policies, and the app's rewarded inventory
 * belongs to AdMob instead.
 */
export function adsenseEnabled(): boolean {
  return adsenseClient() !== null && !isNative();
}

const SCRIPT_ID = 'adsense-loader';

/**
 * Load the AdSense library once.
 *
 * Idempotent, because every slot calls it and React will mount slots more than
 * once. Resolves false when adverts are off, so callers can render nothing
 * rather than an empty box that reserves space for an advert that never comes.
 */
export function loadAdsense(): boolean {
  if (!adsenseEnabled()) return false;
  if (typeof document === 'undefined') return false;
  if (document.getElementById(SCRIPT_ID)) return true;

  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient()}`;
  document.head.appendChild(script);
  return true;
}

/**
 * Hand a mounted slot to AdSense.
 *
 * The library reads the DOM when pushed to, so this runs after the element is
 * in the tree. It throws if the same element is filled twice — which happens
 * in development under StrictMode's double mount — and a thrown advert must
 * never take a game screen down with it.
 */
export function fillSlot(): void {
  try {
    const w = window as unknown as { adsbygoogle?: unknown[] };
    (w.adsbygoogle = w.adsbygoogle ?? []).push({});
  } catch {
    // An advert that failed to fill is an advert that is not there. The game
    // carries on regardless; there is nothing useful to tell the player.
  }
}
