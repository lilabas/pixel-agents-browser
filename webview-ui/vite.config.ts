import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  base: './',
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:3100',
        ws: true,
      },
    },
  },
})
