import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { fileURLToPath } from 'node:url';

export default defineWorkersConfig({
  resolve: {
    alias: {
      '@blokduo/engine': fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url)),
    },
  },
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        // Every test mints its own random room code, so tests cannot see each
        // other's state anyway. Per-test isolation additionally requires every
        // Durable Object to be quiescent between tests, which a room never is:
        // it holds live WebSockets and always has an idle-cleanup alarm armed.
        isolatedStorage: false,
        miniflare: {
          // Real games give a player 45 seconds and hold a dropped seat for a
          // minute. Shortened here so the alarm-driven rules can be asserted
          // instead of assumed — still long enough that the other tests, which
          // finish in milliseconds, never trip over them.
          bindings: { TURN_MS: '1200', RECONNECT_GRACE_MS: '1200' },
        },
      },
    },
  },
});
