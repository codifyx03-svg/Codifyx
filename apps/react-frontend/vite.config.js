import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.FRONTEND_PORT || 3000),
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PUBLIC_API_PORT || 3003}`,
        changeOrigin: true
      },
      '/admin-api': {
        target: `http://localhost:${process.env.ADMIN_API_PORT || 3004}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/admin-api/, '/api/admin')
      }
    }
  }
});
