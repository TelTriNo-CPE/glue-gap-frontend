import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // api-gateway (port 3030)
      '/upload': 'http://localhost:3030',
      '/results': 'http://localhost:3030',
      '/tiles': 'http://localhost:3030',
      // image-processor (port 8080) — specific paths before catch-all /exports
      '/analyze-gaps': 'http://localhost:8080',
      '/exports/excel': 'http://localhost:8080',
      '/exports/image': 'http://localhost:8080',
      // api-gateway (port 3030) — presigned URL endpoints: GET /exports/:stem/excel|image
      '/exports': 'http://localhost:3030',
    },
  },
})
