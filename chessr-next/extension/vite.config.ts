import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyDirBeforeWrite: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content/index.tsx'),
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'content.css';
          }
          return '[name].[ext]';
        },
      },
    },
    cssCodeSplit: false,
  },
  publicDir: 'public',
});
