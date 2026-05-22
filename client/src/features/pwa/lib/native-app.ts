import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'

const LAST_ROUTE_KEY = 'bookorbit:pwa:last-route'
const LAST_ROUTE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30

const USER_CACHE_NAMES = new Set([
  'book-covers',
  'book-thumbnails',
  'bookorbit-book-covers',
  'bookorbit-book-thumbnails',
  'bookorbit-api-reader',
  'bookorbit-epub-assets',
  'bookorbit-comic-pages',
  'bookorbit-fonts',
])

const USER_LOCAL_STORAGE_PREFIXES = ['reader:progress:', 'reader:epub-tts:', 'reader:tts-session:']

interface LastRouteSnapshot {
  fullPath: string
  savedAt: number
}

interface CapacitorBridge {
  getPlatform?: () => string
  isNativePlatform?: () => boolean
}

function isBrowser() {
  return typeof window !== 'undefined'
}

export function isCapacitorNative(): boolean {
  if (!isBrowser()) return false
  const capacitor = (window as Window & { Capacitor?: CapacitorBridge }).Capacitor
  return capacitor?.isNativePlatform?.() === true || ['android', 'ios'].includes(capacitor?.getPlatform?.() ?? '')
}

export function isStandaloneDisplay(): boolean {
  if (!isBrowser()) return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true || isCapacitorNative()
}

function readLastRoute(): LastRouteSnapshot | null {
  if (!isBrowser()) return null
  try {
    const raw = window.localStorage.getItem(LAST_ROUTE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastRouteSnapshot>
    if (typeof parsed.fullPath !== 'string' || typeof parsed.savedAt !== 'number') return null
    if (Date.now() - parsed.savedAt > LAST_ROUTE_MAX_AGE_MS) {
      window.localStorage.removeItem(LAST_ROUTE_KEY)
      return null
    }
    return { fullPath: parsed.fullPath, savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

function isRestorablePath(path: string): boolean {
  return (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.startsWith('/login') &&
    !path.startsWith('/setup') &&
    !path.startsWith('/forgot-password') &&
    !path.startsWith('/reset-password') &&
    !path.startsWith('/oauth2-callback') &&
    !path.startsWith('/magic')
  )
}

function shouldRememberRoute(route: RouteLocationNormalizedLoaded): boolean {
  return !route.meta.public && isRestorablePath(route.fullPath)
}

export function rememberPwaRoute(route: RouteLocationNormalizedLoaded): void {
  if (!isBrowser() || !shouldRememberRoute(route)) return
  try {
    window.localStorage.setItem(
      LAST_ROUTE_KEY,
      JSON.stringify({
        fullPath: route.fullPath,
        savedAt: Date.now(),
      } satisfies LastRouteSnapshot),
    )
  } catch {
    // localStorage can be unavailable in private modes.
  }
}

export function resolveStandaloneLaunchRedirect(to: RouteLocationNormalizedLoaded): string | null {
  if (!isStandaloneDisplay()) return null
  if (to.path !== '/' || to.hash || Object.keys(to.query).length > 0) return null

  const snapshot = readLastRoute()
  if (!snapshot || snapshot.fullPath === '/' || !isRestorablePath(snapshot.fullPath)) return null
  return snapshot.fullPath
}

export function registerPwaRoutePersistence(router: Router): void {
  let launchRestoreAttempted = false
  let pendingLaunchRestore: string | null = null

  router.beforeEach((to) => {
    if (launchRestoreAttempted) return true
    const redirect = resolveStandaloneLaunchRedirect(to)
    if (!redirect) return true
    launchRestoreAttempted = true
    pendingLaunchRestore = redirect
    window.setTimeout(() => {
      if (pendingLaunchRestore !== redirect) return
      pendingLaunchRestore = null
      void router.push(redirect)
    }, 0)
    return true
  })

  router.afterEach((to) => {
    if (pendingLaunchRestore && to.path === '/' && to.fullPath === '/') return
    rememberPwaRoute(to)
  })
}

export async function clearBookorbitRuntimeCaches(): Promise<void> {
  if (typeof caches === 'undefined') return
  const names = await caches.keys()
  await Promise.all(names.filter((name) => USER_CACHE_NAMES.has(name) || name.startsWith('bookorbit-user-')).map((name) => caches.delete(name)))
}

export function clearPwaUserState(): void {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(LAST_ROUTE_KEY)
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i)
      if (key && USER_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        window.localStorage.removeItem(key)
      }
    }
  } catch {
    // Ignore storage failures during logout/auth reset.
  }
}
