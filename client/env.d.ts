/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

import 'vue-router'
import type { RouteLocationNormalizedLoaded } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    maxWidth?: string
    title?: string | ((to: RouteLocationNormalizedLoaded) => string)
  }
}
