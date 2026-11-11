import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: 'static',
  build: { outDir: 'public', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5176, strictPort: false, proxy: { '/api': 'http://localhost:3001' } },
})
