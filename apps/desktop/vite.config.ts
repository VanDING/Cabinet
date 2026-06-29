import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [tailwindcss(), react()],
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
    proxy: {
      '/api': `http://localhost:${process.env.PORT ?? 3000}`,
      '/health': `http://localhost:${process.env.PORT ?? 3000}`,
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'router-vendor': ['react-router-dom'],
          'xyflow-vendor': ['@xyflow/react'],
          'grid-layout-vendor': ['react-grid-layout'],
          'marked-vendor': ['marked'],
        },
      },
    },
  },
  clearScreen: false,
});
