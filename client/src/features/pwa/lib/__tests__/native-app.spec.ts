import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { clearPwaUserState, registerPwaRoutePersistence, rememberPwaRoute, resolveStandaloneLaunchRedirect } from '../native-app'

function makeRoute(overrides: Partial<RouteLocationNormalizedLoaded>): RouteLocationNormalizedLoaded {
  return {
    fullPath: '/',
    path: '/',
    query: {},
    hash: '',
    meta: {},
    ...overrides,
  } as RouteLocationNormalizedLoaded
}

function setStandalone(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn<(query: string) => MediaQueryList>(
      () =>
        ({
          matches,
          addEventListener: vi.fn<() => void>(),
          removeEventListener: vi.fn<() => void>(),
        }) as unknown as MediaQueryList,
    ),
  })
}

describe('native app PWA helpers', () => {
  beforeEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    setStandalone(false)
    delete (window as Window & { Capacitor?: unknown }).Capacitor
  })

  it('remembers restorable private routes', () => {
    rememberPwaRoute(makeRoute({ fullPath: '/read/1/2?format=epub', path: '/read/1/2' }))

    const stored = JSON.parse(localStorage.getItem('bookorbit:pwa:last-route') ?? '{}')
    expect(stored.fullPath).toBe('/read/1/2?format=epub')
  })

  it('does not remember public auth routes', () => {
    rememberPwaRoute(makeRoute({ fullPath: '/login', path: '/login', meta: { public: true } }))

    expect(localStorage.getItem('bookorbit:pwa:last-route')).toBeNull()
  })

  it('redirects root launches in standalone mode to the last route', () => {
    setStandalone(true)
    localStorage.setItem(
      'bookorbit:pwa:last-route',
      JSON.stringify({
        fullPath: '/read/1/2?format=epub',
        savedAt: Date.now(),
      }),
    )

    expect(resolveStandaloneLaunchRedirect(makeRoute({ fullPath: '/', path: '/' }))).toBe('/read/1/2?format=epub')
  })

  it('restores standalone launches with a router push so Dashboard remains behind the restored route', async () => {
    vi.useFakeTimers()
    setStandalone(true)
    localStorage.setItem(
      'bookorbit:pwa:last-route',
      JSON.stringify({
        fullPath: '/read/1/2?format=epub',
        savedAt: Date.now(),
      }),
    )

    const beforeEachHandlers: Array<(to: RouteLocationNormalizedLoaded) => unknown> = []
    const afterEachHandlers: Array<(to: RouteLocationNormalizedLoaded) => void> = []
    const router = {
      beforeEach: vi.fn<(handler: (to: RouteLocationNormalizedLoaded) => unknown) => void>((handler) => {
        beforeEachHandlers.push(handler)
      }),
      afterEach: vi.fn<(handler: (to: RouteLocationNormalizedLoaded) => void) => void>((handler) => {
        afterEachHandlers.push(handler)
      }),
      push: vi.fn<(to: string) => Promise<void>>(() => Promise.resolve()),
    } as unknown as Router

    registerPwaRoutePersistence(router)

    expect(beforeEachHandlers[0]?.(makeRoute({ fullPath: '/', path: '/' }))).toBe(true)
    afterEachHandlers[0]?.(makeRoute({ fullPath: '/', path: '/' }))
    expect(JSON.parse(localStorage.getItem('bookorbit:pwa:last-route') ?? '{}').fullPath).toBe('/read/1/2?format=epub')

    await vi.runAllTimersAsync()

    expect(router.push).toHaveBeenCalledWith('/read/1/2?format=epub')
  })

  it('does not redirect normal browser root loads', () => {
    localStorage.setItem(
      'bookorbit:pwa:last-route',
      JSON.stringify({
        fullPath: '/read/1/2?format=epub',
        savedAt: Date.now(),
      }),
    )

    expect(resolveStandaloneLaunchRedirect(makeRoute({ fullPath: '/', path: '/' }))).toBeNull()
  })

  it('redirects Capacitor native root launches to the last route', () => {
    const nativeWindow = window as Window & { Capacitor?: { isNativePlatform: () => boolean } }
    nativeWindow.Capacitor = {
      isNativePlatform: () => true,
    }
    localStorage.setItem(
      'bookorbit:pwa:last-route',
      JSON.stringify({
        fullPath: '/read/1/2?format=epub',
        savedAt: Date.now(),
      }),
    )

    expect(resolveStandaloneLaunchRedirect(makeRoute({ fullPath: '/', path: '/' }))).toBe('/read/1/2?format=epub')
  })

  it('clears user-specific local PWA state', () => {
    localStorage.setItem('bookorbit:pwa:last-route', '{"fullPath":"/read/1/2","savedAt":1}')
    localStorage.setItem('reader:progress:2', '{}')
    localStorage.setItem('reader:epub-tts:2:1', '4')
    localStorage.setItem('theme', '"dark"')

    clearPwaUserState()

    expect(localStorage.getItem('bookorbit:pwa:last-route')).toBeNull()
    expect(localStorage.getItem('reader:progress:2')).toBeNull()
    expect(localStorage.getItem('reader:epub-tts:2:1')).toBeNull()
    expect(localStorage.getItem('theme')).toBe('"dark"')
  })
})
