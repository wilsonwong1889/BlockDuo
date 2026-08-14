import { apiUrl } from '../net/config';

/**
 * Crash reporting, without a reporting service.
 *
 * Reports go to our own Worker, which logs them — they appear in `wrangler
 * tail` and in the Workers dashboard. That is somewhere to look when a player
 * says "it broke", which is the whole point; nothing is stored, so there is
 * nothing to prune and nothing held about anybody.
 *
 * Swapping in a real service later means changing `send` and nothing else.
 */

/** Reports one page will send before it stops talking. */
const MAX_REPORTS = 5;

const seen = new Set<string>();
let sent = 0;

function send(payload: Record<string, string>) {
  // keepalive, so a crash on the way out of the page still gets out.
  void fetch(apiUrl('/api/telemetry/error'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // A report that cannot be sent is not worth a second error.
  });
}

export function reportError(error: unknown, context = '') {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? '') : '';

  // One bug that fires on every frame would otherwise send a request on every
  // frame. Identical messages are counted once, and a page gives up after a few.
  const fingerprint = `${context}:${message}`;
  if (seen.has(fingerprint) || sent >= MAX_REPORTS) return;
  seen.add(fingerprint);
  sent += 1;

  send({
    message,
    stack,
    screen: `${context} ${window.location.hash}`.trim(),
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
  });
}

/**
 * Catch what never reaches a React boundary: a listener that throws, a promise
 * nobody awaited. Those are exactly the failures that otherwise leave no trace
 * at all, because the screen keeps working and the player just sees it misbehave.
 */
export function installGlobalErrorReporting() {
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, 'window');
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, 'promise');
  });
}
