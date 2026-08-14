import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 1.month.day.build, read from version.json at the repo root.
 *
 * The file is the source of truth rather than the build machine, because the
 * deploy builds from a shallow clone: counting the day's commits there sees one
 * commit and stamped every deploy .1, whichever update it really was. It also
 * makes the version a property of the commit — rebuilding the same commit
 * tomorrow produces the same version instead of a new one.
 *
 * Separating month and day with a dot is not cosmetic: the old `1.${month}${day}`
 * gave January 12th and November 2nd the same 1.112.
 */
function appVersion(): string {
  const handed = process.env.APP_BUILD;

  try {
    const raw = readFileSync(new URL('../../version.json', import.meta.url), 'utf8');
    const { date, build } = JSON.parse(raw) as { date: string; build: number };
    const [, month, day] = date.split('-');
    return `1.${Number(month)}.${Number(day)}.${handed ?? build}`;
  } catch {
    // No file, or an unreadable one. Fall back to the build machine's date so a
    // build still carries something truthful about when it was made.
    const now = new Date();
    return `1.${now.getMonth() + 1}.${now.getDate()}.${handed ?? 0}`;
  }
}

const version = appVersion();

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
