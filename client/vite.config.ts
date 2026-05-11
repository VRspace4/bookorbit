import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools(), tailwindcss()],
  resolve: {
    dedupe: ['vue'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@bookorbit/types': fileURLToPath(new URL('../packages/types/src/index.ts', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['@tanstack/vue-table', '@tanstack/vue-virtual'],
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.host) proxyReq.setHeader('x-forwarded-host', req.headers.host)
            const localPort = (req.socket as { localPort?: number })?.localPort
            if (localPort) proxyReq.setHeader('x-forwarded-port', String(localPort))
            proxyReq.setHeader('x-forwarded-proto', 'http')
          })
        },
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
