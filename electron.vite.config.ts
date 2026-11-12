import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(root, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(root, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    publicDir: resolve(root, 'assets'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(root, 'src/renderer/index.html'),
      },
    },
  },
});
