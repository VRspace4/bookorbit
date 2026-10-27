import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetPwaServiceWorkerForTest, usePwaServiceWorker } from '../usePwaServiceWorker'

type RegisterOptions = {
  onNeedRefresh?: () => void
  onNeedReload?: () => void
  onOfflineReady?: () => void
}

const registerSW = vi.fn<(...args: unknown[]) => unknown>()
const updateServiceWorker = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined)
let lastOptions: RegisterOptions | undefined

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: RegisterOptions) => {
    lastOptions = options
    registerSW(options)
    return updateServiceWorker
  },
}))

describe('usePwaServiceWorker', () => {
  beforeEach(() => {
    _resetPwaServiceWorkerForTest()
    registerSW.mockClear()
    updateServiceWorker.mockReset()
    updateServiceWorker.mockResolvedValue(undefined)
    lastOptions = undefined
    sessionStorage.clear()

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn<(...args: unknown[]) => unknown>(),
      },
    })

    // Remote HTTPS dev enables registration via VITE_HMR_HOST.
    vi.stubEnv('VITE_HMR_HOST', 'bookorbit.ridethew.com')
    vi.stubEnv('VITE_PWA_DEV', '')
    vi.stubEnv('VITE_PWA_UPDATE_PROMPTS', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    sessionStorage.clear()
    _resetPwaServiceWorkerForTest()
    // @ts-expect-error test cleanup
    delete navigator.serviceWorker
  })

  it('does not register when PWA registration is disabled', async () => {
    vi.stubEnv('VITE_HMR_HOST', '')
    vi.stubEnv('VITE_PWA_DEV', '')

    const { register, needRefresh } = usePwaServiceWorker()
    await register()
    expect(registerSW).not.toHaveBeenCalled()
    expect(needRefresh.value).toBe(false)
  })

  it('does not surface update prompts by default in development', async () => {
    const sw = usePwaServiceWorker()
    await sw.register()

    expect(registerSW).toHaveBeenCalledOnce()
    lastOptions?.onNeedRefresh?.()
    lastOptions?.onNeedReload?.()
    lastOptions?.onOfflineReady?.()

    expect(sw.needRefresh.value).toBe(false)
    expect(sw.restartReady.value).toBe(false)
    expect(sw.offlineReady.value).toBe(true)
  })

  it('surfaces update prompts when VITE_PWA_UPDATE_PROMPTS=true', async () => {
    vi.stubEnv('VITE_PWA_UPDATE_PROMPTS', 'true')

    const sw = usePwaServiceWorker()
    await sw.register()

    lastOptions?.onNeedRefresh?.()
    expect(sw.needRefresh.value).toBe(true)

    lastOptions?.onNeedReload?.()
    expect(sw.restartReady.value).toBe(true)
  })

  it('does not re-show needRefresh after dismiss within the same session', async () => {
    vi.stubEnv('VITE_PWA_UPDATE_PROMPTS', 'true')

    const sw = usePwaServiceWorker()
    await sw.register()

    lastOptions?.onNeedRefresh?.()
    expect(sw.needRefresh.value).toBe(true)

    sw.dismissUpdate()
    expect(sw.needRefresh.value).toBe(false)
    expect(sessionStorage.getItem('bookorbit:pwa:update-dismissed')).toBe('1')

    lastOptions?.onNeedRefresh?.()
    expect(sw.needRefresh.value).toBe(false)
  })

  it('activateUpdate clears dismiss state and marks restart ready', async () => {
    vi.stubEnv('VITE_PWA_UPDATE_PROMPTS', 'true')

    const sw = usePwaServiceWorker()
    await sw.register()

    lastOptions?.onNeedRefresh?.()
    sw.dismissUpdate()
    expect(sessionStorage.getItem('bookorbit:pwa:update-dismissed')).toBe('1')

    await sw.activateUpdate()

    expect(updateServiceWorker).toHaveBeenCalledWith(false)
    expect(sw.needRefresh.value).toBe(false)
    expect(sw.restartReady.value).toBe(true)
    expect(sessionStorage.getItem('bookorbit:pwa:update-dismissed')).toBeNull()
  })

  it('restartNow clears dismiss state before reload', async () => {
    const reload = vi.fn<() => void>()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    })

    const sw = usePwaServiceWorker()
    sw.dismissUpdate()
    expect(sessionStorage.getItem('bookorbit:pwa:update-dismissed')).toBe('1')

    sw.restartNow()
    expect(sessionStorage.getItem('bookorbit:pwa:update-dismissed')).toBeNull()
    expect(reload).toHaveBeenCalledOnce()
  })
})
