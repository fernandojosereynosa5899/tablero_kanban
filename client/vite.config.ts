import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, '/');
          if (
            norm.includes('/node_modules/react/') ||
            norm.includes('/node_modules/react-dom/') ||
            norm.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          if (
            norm.includes('/node_modules/framer-motion/') ||
            norm.includes('/node_modules/motion-dom/') ||
            norm.includes('/node_modules/motion-utils/')
          ) {
            return 'vendor-motion';
          }
          if (norm.includes('/node_modules/@dnd-kit/')) {
            return 'vendor-dnd';
          }
          if (
            norm.includes('/node_modules/socket.io-client/') ||
            norm.includes('/node_modules/engine.io-client/') ||
            norm.includes('/node_modules/socket.io-parser/')
          ) {
            return 'vendor-socket';
          }
          if (norm.includes('/node_modules/lucide-react/') || norm.includes('/node_modules/sonner/')) {
            return 'vendor-ui';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
