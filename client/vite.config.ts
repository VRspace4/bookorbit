import { fileURLToPath, URL } from 'node:url'
import { Agent } from 'node:http'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const apiAgent = new Agent({ keepAlive: true })
/** Lets a second dev client point at a throwaway API instance, so restart testing leaves the main stack alone. */
const apiTarget = process.env.BOOKORBIT_API_TARGET ?? process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:6262'
const offlineShellUrl = '__bookorbit_offline_shell'

const hmrHost = process.env.VITE_HMR_HOST
const enableDevPwa = process.env.VITE_PWA_DEV === 'true' || Boolean(hmrHost)
const enableVueDevTools = process.env.VITE_VUE_DEVTOOLS === 'true'

// https://vite.dev/config/
export default defineConfig({
  define: {
    __INTLIFY_PROD_DEVTOOLS__: false,
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
  },
  plugins: [
    vue(),
    ...(enableVueDevTools ? [vueDevTools()] : []),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: [
        'favicon.ico',
        'pwa-icon-source.svg',
        'apple-touch-icon-180x180.png',
        'pwa-64x64.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'maskable-icon-512x512.png',
      ],
      manifest: {
        id: '/',
        name: 'BookOrbit',
        short_name: 'BookOrbit',
        description: 'Your personal book library and reading space',
        theme_color: '#1e1e18',
        background_color: '#fafaf8',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Dashboard',
            short_name: 'Dashboard',
            url: '/dashboard',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Libraries',
            short_name: 'Libraries',
            url: '/libraries',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Settings',
            short_name: 'Settings',
            url: '/settings',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        globIgnores: ['**/assets/foliate/**'],
        // Keep the offline shell at a separate path. Workbox maps '/' and its query variants to
        // precached index.html before the NetworkFirst route can contact the auth proxy.
        manifestTransforms: [
          (entries) => ({
            manifest: entries.map((entry) => (entry.url === 'index.html' ? { ...entry, url: offlineShellUrl } : entry)),
          }),
        ],
        navigateFallback: null,
        runtimeCaching: [
          {
            // Page loads must hit the network first: an edge auth proxy (e.g. Cloudflare Access) needs to
            // see every navigation to redirect an expired session to its login page. Serving the precached
            // shell unconditionally (the old `navigateFallback` behavior) hid the request from the proxy
            // entirely and left the app stuck logged out with no way back in short of clearing site data.
            urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
              // No networkTimeoutSeconds: a slow proxy redirect must win over the cached page.
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              precacheFallback: {
                fallbackURL: offlineShellUrl,
              },
              // Status 0 here would include an auth proxy's opaqueredirect and cache it as the page.
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/books\/\d+\/cover\?(?:[^#]*&)?t=[^#]*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bookorbit-book-covers',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/books\/\d+\/thumbnail\?(?:[^#]*&)?t=[^#]*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bookorbit-book-thumbnails',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/books\/\d+\/cover(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'book-covers',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/books\/\d+\/thumbnail(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'book-thumbnails',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/epub\/\d+\/info(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bookorbit-api-reader',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/reader\/(preferences\/\d+|defaults)(\/[^?]+)?(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bookorbit-api-reader',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 160,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/books\/\d+(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bookorbit-api-reader',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/epub\/\d+\/file\/.*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bookorbit-epub-assets',
              expiration: {
                maxEntries: 800,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/cbz\/files\/\d+\/pages(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bookorbit-api-reader',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/cbz\/files\/\d+\/pages\/\d+(\?.*)?$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bookorbit-comic-pages',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^.*\/api\/v1\/fonts(\/.*)?(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'bookorbit-fonts',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: enableDevPwa,
        type: 'module',
      },
    }),
  ],
  resolve: {
    dedupe: ['vue'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@bookorbit/types': fileURLToPath(new URL('../packages/types/src/index.ts', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['@tanstack/vue-virtual'],
    exclude: ['@embedpdf/core', '@embedpdf/core/vue'],
  },
  server: {
    host: true,
    port: Number(process.env.VITE_PORT ?? 6263),
    strictPort: true,
    allowedHosts: true,
    ...(hmrHost
      ? {
          hmr: {
            host: hmrHost,
            protocol: 'wss',
            clientPort: 443,
          },
        }
      : {}),
    proxy: {
      '/api': {
        target: apiTarget,
        agent: apiAgent,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.host) proxyReq.setHeader('x-forwarded-host', req.headers.host)
            const localPort = (req.socket as { localPort?: number })?.localPort
            if (localPort) proxyReq.setHeader('x-forwarded-port', String(localPort))
            proxyReq.setHeader('x-forwarded-proto', hmrHost ? 'https' : 'http')
          })
        },
      },
      '/socket.io': {
        target: apiTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
