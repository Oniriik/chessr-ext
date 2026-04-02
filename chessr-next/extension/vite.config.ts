import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const target = process.env.BUILD_TARGET; // 'content' | 'background' | 'billing' | undefined (streamer)
const isWatch = process.argv.includes('--watch');

function buildConfig() {
  if (target === 'content') {
    return {
      emptyOutDir: !isWatch,
      rollupOptions: {
        input: resolve(__dirname, 'src/content/index.tsx'),
        output: {
          format: 'iife' as const,
          entryFileNames: 'content.js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
      publicDir: false as const,
    };
  }

  if (target === 'background') {
    return {
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(__dirname, 'src/background/index.ts'),
        output: {
          entryFileNames: 'background.js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
      publicDir: false as const,
    };
  }

  if (target === 'billing') {
    return {
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(__dirname, 'src/billing/index.tsx'),
        output: {
          format: 'iife' as const,
          entryFileNames: 'billing.js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
      publicDir: false as const,
    };
  }

  // Streamer — IIFE format to avoid TDZ issues from circular deps
  // CSS is injected via JS (same as content script), no separate CSS file needed
  return {
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/streamer/index.tsx'),
      output: {
        format: 'iife' as const,
        entryFileNames: 'streamer.js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    publicDir: 'public',
  };
}

const cfg = buildConfig();

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: cfg.emptyOutDir,
    rollupOptions: cfg.rollupOptions,
    cssCodeSplit: true,
  },
  publicDir: cfg.publicDir,
});
