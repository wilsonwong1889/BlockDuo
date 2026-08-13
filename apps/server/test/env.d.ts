import type { Env } from '../src/RoomDO';

/**
 * Teach `cloudflare:test` about this Worker's bindings, so a test can reach a
 * Durable Object directly instead of only through fetch. Storage-level access is
 * what lets the all-time migration be tested: the state it repairs cannot be
 * produced through the public API, only left behind by an older build.
 */
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
