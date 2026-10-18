import { defineConfig } from 'vite';

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
    // stage.html is the character stage (src/stage.ts), shipped so previews can show it too
    rollupOptions: {
      input: { main: 'index.html', stage: 'stage.html' },
      // the harbor district loads on demand (its own chunk, from src/harbor/index.ts): name it for itself
      output: { chunkFileNames: (c) => (c.facadeModuleId?.endsWith('/src/harbor/index.ts') ? 'assets/harbor-[hash].js' : 'assets/[name]-[hash].js') },
    },
  },
});
