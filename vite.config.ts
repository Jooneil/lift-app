import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // Precise aliases for optional modules referenced by @supabase/auth-js
      '@supabase/auth-js/dist/module/lib/types': path.resolve(
        __dirname,
        'src/shims/supabase-types.js',
      ),
      '@supabase/auth-js/dist/module/lib/web3/ethereum': path.resolve(
        __dirname,
        'src/shims/empty.js',
      ),
    },
  },
  server: {
    host: true, // expose on LAN
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
