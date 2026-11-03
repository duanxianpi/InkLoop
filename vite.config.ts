import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  base: '/',
  plugins: [react()],
  build: {
    outDir: '../../dist/public',
    emptyOutDir: true,
  },
});
