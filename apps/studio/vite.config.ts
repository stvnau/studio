import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.GUIDE_API ?? 'http://localhost:5170';

// The studio talks to the API over a dev proxy so requests are same-origin
// (session cookies just work) and the production build can be served by the
// same server with no config change.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/g': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
