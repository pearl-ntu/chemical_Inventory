import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base + HashRouter means the built app works from any path:
// GitHub Pages project sites, a subfolder, or even file:// — no config needed.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
})
