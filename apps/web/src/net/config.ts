/**
 * Where the duo server lives.
 *
 * In production the Worker is routed on the same origin as the site, so the app
 * shipped inside the native shell and the app served from the web both just talk
 * to wherever they came from. Dev points at `wrangler dev`, and an explicit
 * VITE_SERVER_URL overrides both — which is what the native build uses, since a
 * file:// origin has nothing to be relative to.
 */
const configured = import.meta.env.VITE_SERVER_URL;

export function serverOrigin(): string {
  if (configured) return configured.replace(/\/$/, '');
  if (import.meta.env.DEV) return 'http://localhost:8787';
  return window.location.origin;
}

export function apiUrl(path: string): string {
  return `${serverOrigin()}${path}`;
}

export function roomSocketUrl(code: string, ticket: string): string {
  const base = serverOrigin().replace(/^http/, 'ws');
  const params = new URLSearchParams({ ticket });
  return `${base}/api/room/${code}/ws?${params.toString()}`;
}

/** A shareable link that drops the recipient straight into the room. */
export function inviteUrl(code: string): string {
  return `${window.location.origin}${window.location.pathname}#/duo/${code}`;
}

/** Where the game lives now. */
export const CANONICAL_ORIGIN = 'https://blokduo.ca';

/**
 * Whether this page is being served from the address the game used to use.
 *
 * The workers.dev origin still serves the game, deliberately, so invite links
 * handed out before the domain existed keep working. But progress is kept
 * under credentials in localStorage, which browsers key per origin, so a
 * player who moves across looks like a new one. Matched on the suffix rather
 * than the exact host so a renamed Worker or a preview deployment still counts.
 */
export function isLegacyOrigin(): boolean {
  return window.location.hostname.endsWith('.workers.dev');
}

/** The link that carries a profile from the old origin to the new one. */
export function transferUrl(code: string): string {
  return `${CANONICAL_ORIGIN}/#/move/${code}`;
}
