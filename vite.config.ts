import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Los catálogos son datos grandes y casi estáticos: separarlos evita
        // que el chunk principal crezca con cada nueva receta o plato.
        manualChunks(id) {
          if (id.includes('/src/data/')) return 'food-data';
          if (id.includes('/src/recipes.ts')) return 'recipes';
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true
  }
});