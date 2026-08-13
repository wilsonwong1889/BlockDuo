import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * 1.month.day.build — the build number counting the day's commits, so two
 * versions shipped on the same day are told apart by the work between them.
 *
 * Separating month and day with a dot is not cosmetic: the old `1.${month}${day}`
 * gave January 12th and November 2nd the same 1.112.
 */
function buildNumber(now: Date): number {
  // Docker builds have no .git — .dockerignore excludes it — so the count can be
  // handed in instead. Anything without either is still a valid version, at .0.
  const handed = process.env.APP_BUILD;
  if (handed && /^\d+$/.test(handed)) return Number(handed);

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  try {
    const count = execFileSync(
      'git',
      ['rev-list', '--count', `--since=${midnight.toISOString()}`, 'HEAD'],
      { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return Number(count.toString().trim()) || 0;
  } catch {
    return 0;
  }
}

const buildDate = new Date();
const version = `1.${buildDate.getMonth() + 1}.${buildDate.getDate()}.${buildNumber(buildDate)}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      // Point straight at the engine's TypeScript source. It has no build step —
      // it is consumed as source by the web app and by the Worker alike.
      '@blokduo/engine': fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
