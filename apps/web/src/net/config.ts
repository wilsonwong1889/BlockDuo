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
