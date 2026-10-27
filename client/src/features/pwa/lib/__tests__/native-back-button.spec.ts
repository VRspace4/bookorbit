import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'

const addListener = vi.fn<(event: string, handler: () => void) => Promise<{ remove: () => void }>>(() =>
  Promise.resolve({ remove: vi.fn<() => void>() }),
)
const minimizeApp = vi.fn<() => Promise<void>>(() => Promise.resolve())

vi.mock('@capacitor/app', () => ({
  App: { addListener, minimizeApp },
}))

vi.mock('@/features/reader/shared/lib/reader-navigation', () => ({
  isReaderPath: (path: string) => path.startsWith('/read'),
  exitReader: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}))

describe('registerNativeBackButton', () => {
  beforeEach(() => {
    vi.resetModules()
    addListener.mockClear()
    minimizeApp.mockClear()
    delete (window as Window & { Capacitor?: unknown }).Capacitor
  })

  it('registers a Capacitor back handler on native Android', async () => {
    ;(window as Window & { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    }

    const router = {
      currentRoute: { value: { path: '/read/1/2' } },
      back: vi.fn<() => void>(),
    } as unknown as Router

    const { registerNativeBackButton } = await import('../native-back-button')
    registerNativeBackButton(router)

    await vi.waitFor(() => expect(addListener).toHaveBeenCalledWith('backButton', expect.any(Function)))

    const handler = addListener.mock.calls[0]?.[1]
    expect(handler).toBeTypeOf('function')

    const { exitReader } = await import('@/features/reader/shared/lib/reader-navigation')
    handler?.()
    expect(exitReader).toHaveBeenCalledWith(router)
  })

  it('does nothing in the browser', async () => {
    const router = { currentRoute: { value: { path: '/read/1/2' } } } as unknown as Router
    const { registerNativeBackButton } = await import('../native-back-button')
    registerNativeBackButton(router)
    expect(addListener).not.toHaveBeenCalled()
  })
})
