import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: 'react/jsx-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js') },
      { find: 'react-dom/client', replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js') },
      { find: 'react-dom', replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js') },
      { find: /^react$/, replacement: path.resolve(__dirname, 'node_modules/react/index.js') },
      { find: '@supabase/auth-js/dist/module/lib/types', replacement: path.resolve(__dirname, 'src/shims/supabase-types.js') },
      { find: '@supabase/auth-js/dist/module/lib/web3/ethereum', replacement: path.resolve(__dirname, 'src/shims/empty.js') }
    ],
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
