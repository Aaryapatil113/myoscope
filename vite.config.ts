import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' makes the build work on GitHub Pages without extra config
export default defineConfig({
  plugins: [react()],
  base: './',
});
