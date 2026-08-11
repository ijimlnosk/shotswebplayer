import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' so the build works from file:// or any subpath (macOS widget hosts).
export default defineConfig({
  base: './',
  plugins: [react()],
})
