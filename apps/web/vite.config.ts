import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Em dev, /api vai para a API local sem precisar de CORS.
    proxy: { '/api': 'http://localhost:3333' },
  },
  preview: { port: 4173, proxy: { '/api': 'http://localhost:3333' } },
  build: {
    sourcemap: true,
    rolldownOptions: {
      output: {
        // Biblioteca de gráficos em chunk próprio: muda pouco, fica em cache entre deploys.
        codeSplitting: {
          groups: [
            {
              name: 'charts',
              test: /node_modules[\\/](recharts|d3-|victory-vendor|es-toolkit|immer|@reduxjs|reselect|redux)/,
            },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
  test: { environment: 'node' },
});
