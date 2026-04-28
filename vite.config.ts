import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiGateway = env.VITE_API_GATEWAY_URL || 'http://localhost:3030'
  const imageProcessor = env.VITE_IMAGE_PROCESSOR_URL || 'http://localhost:8080'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        // api-gateway
        // Upload needs generous timeouts for 400 MB+ files
        '/upload': {
          target: apiGateway,
          timeout: 600000,       // 10 min – proxy ↔ backend socket
          proxyTimeout: 600000,  // 10 min – proxy connect timeout
        },
        '/results': {
          target: apiGateway,
          changeOrigin: true,
        },
        '/tiles': {
          target: imageProcessor,
          changeOrigin: true,
        },
        // image-processor — specific paths before catch-all /exports
        '/analyze-gaps': imageProcessor,
        '/exports/excel': imageProcessor,
        '/exports/image': imageProcessor,
        // api-gateway — presigned URL endpoints: GET /exports/:stem/excel|image
        '/exports': apiGateway,
      },
    },
  }
})
