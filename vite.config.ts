import { defineConfig } from 'vite';

// BASE_PATH is set by the deploy workflows:
//   main:     /robots-rebuild/
//   previews: /robots-rebuild/pr-preview/pr-<n>/
// Locally it falls back to '/' so `npm run dev` works unchanged.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
