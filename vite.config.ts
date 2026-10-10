import { defineConfig } from 'vite';
import { resolve } from 'path';

// BASE_PATH is set by the deploy workflows:
//   main:     /robots-rebuild/
//   previews: /robots-rebuild/pr-preview/pr-<n>/
// Locally it falls back to '/' so `npm run dev` works unchanged.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // index.html: the game (pixel-art). stylized.html: the stylized-3D art direction prototype.
      input: { main: resolve(__dirname, 'index.html'), stylized: resolve(__dirname, 'stylized.html') },
    },
  },
});
