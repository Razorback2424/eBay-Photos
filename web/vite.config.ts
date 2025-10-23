import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      comlink: path.resolve(__dirname, 'src/utils/comlink.ts')
    }
  },
  server: {
    open: true
  }
});
