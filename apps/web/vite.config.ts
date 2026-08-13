import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const buildDate = new Date();
const version = `1.${buildDate.getMonth() + 1}${String(buildDate.getDate()).padStart(2, '0')}`;

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
