import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api/pulse': {
        target: 'http://127.0.0.1:3006',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pulse/, '/v1/pulse'),
      },
    },
  },
});
