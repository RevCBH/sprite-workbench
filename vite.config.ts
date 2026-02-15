import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/sprite-workbench/',
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        workbench: resolve(__dirname, 'sprite-workbench.html'),
      },
    },
  },
});
