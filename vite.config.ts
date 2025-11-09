import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // Precise aliases for optional modules referenced by @supabase/auth-js only
      '@supabase/auth-js/dist/module/lib/types': path.resolve(
        __dirname,
        'src/shims/supabase-types.js'
      ),
      '@supabase/auth-js/dist/module/lib/web3/ethereum': path.resolve(
        __dirname,
        'src/shims/empty.js'
      ),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
