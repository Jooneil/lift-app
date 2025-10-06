import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // expose on LAN
    port: 5173,
    proxy: {
      // anything that starts with /api will be forwarded to the Node server
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
        // if your API sometimes sets absolute Location headers, keep this enabled:
        secure: false,
      },
    },
  },
})
