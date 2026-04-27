import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // api-gateway (port 3030)
      // Upload needs generous timeouts for 400 MB+ files
      '/upload': {
        target: 'http://localhost:3030',
        timeout: 600000,       // 10 min – proxy ↔ backend socket
        proxyTimeout: 600000,  // 10 min – proxy connect timeout
      },
      '/results': {
        target: 'http://localhost:3030',
        changeOrigin: true,
      },
      '/tiles': {
        target: 'http://localhost:3030',
        changeOrigin: true,
      },
      // image-processor (port 8080) — specific paths before catch-all /exports
      '/analyze-gaps': 'http://localhost:8080',
      '/exports/excel': 'http://localhost:8080',
      '/exports/image': 'http://localhost:8080',
      // api-gateway (port 3030) — presigned URL endpoints: GET /exports/:stem/excel|image
      '/exports': 'http://localhost:3030',
    },
  },
})
