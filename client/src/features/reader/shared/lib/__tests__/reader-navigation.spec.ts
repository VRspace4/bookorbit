import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'
import { exitReader, isReaderPath, registerReaderReturnRoute } from '../reader-navigation'

function setHistoryLength(length: number) {
  Object.defineProperty(window.history, 'length', { value: length, configurable: true })
}

function makeRouter(options: { backStepsToExit?: number; exitTarget?: string } = {}): Router {
  let backCalls = 0
  const currentRoute = { value: { path: '/read/1/2', fullPath: '/read/1/2?format=epub' } }
  const exitTarget = options.exitTarget ?? '/book/1?tab=details'

  return {
    currentRoute,
    back: vi.fn<() => Promise<void>>(async () => {
      backCalls++
      const stepsToExit = options.backStepsToExit ?? 1
      if (backCalls >= stepsToExit) {
        currentRoute.value = {
          path: exitTarget.split(/[?#]/, 1)[0] ?? exitTarget,
          fullPath: exitTarget,
        }
        return
      }
      currentRoute.value = { path: '/read/1/1', fullPath: '/read/1/1?format=epub' }
    }),
    isReady: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    replace: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
  } as unknown as Router
}

describe('reader navigation', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/read/1/2?format=epub')
    setHistoryLength(2)
    sessionStorage.clear()
  })

  it('identifies reader paths', () => {
    expect(isReaderPath('/read')).toBe(true)
    expect(isReaderPath('/read/1/2?format=epub')).toBe(true)
    expect(isReaderPath('/book/1')).toBe(false)
  })

  it('uses router back when there is a non-reader route behind the reader', async () => {
    window.history.replaceState({ back: '/book/1?tab=details' }, '', '/read/1/2?format=epub')
    const router = makeRouter()

    await exitReader(router)

    expect(router.back).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('returns to Dashboard when browser history skips straight to book details', async () => {
    sessionStorage.setItem('reader:return-to', '/')
    window.history.replaceState({ back: '/book/1?tab=details' }, '', '/read/1/2?format=epub')
    setHistoryLength(4)
    const router = makeRouter()

    await exitReader(router)

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith('/')
    expect(sessionStorage.getItem('reader:return-to')).toBeNull()
  })

  it('replaces with remembered book details route without using browser back', async () => {
    sessionStorage.setItem('reader:return-to', '/book/1?tab=details')
    window.history.replaceState({ back: '/' }, '', '/read/1/2?format=epub')
    setHistoryLength(4)
    const router = makeRouter()

    await exitReader(router)

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith('/book/1?tab=details')
    expect(sessionStorage.getItem('reader:return-to')).toBeNull()
  })

  it('walks back through stacked reader history entries in one exit', async () => {
    window.history.replaceState({ back: '/' }, '', '/read/1/2?format=epub')
    setHistoryLength(4)
    const router = makeRouter({ backStepsToExit: 2, exitTarget: '/' })

    await exitReader(router)

    expect(router.back).toHaveBeenCalledTimes(2)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('falls back to Dashboard when the reader was opened without prior app history', async () => {
    window.history.replaceState({ back: null }, '', '/read/1/2?format=epub')
    setHistoryLength(1)
    const router = makeRouter()

    await exitReader(router)

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith({ name: 'dashboard' })
  })

  it('falls back to Dashboard when history only contains reader routes', async () => {
    window.history.replaceState({ back: '/read/1/1?format=epub' }, '', '/read/1/2?format=epub')
    setHistoryLength(3)
    const router = makeRouter({ backStepsToExit: 999 })

    await exitReader(router)

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith({ name: 'dashboard' })
  })

  it('falls back to Dashboard instead of backing into auth routes', async () => {
    window.history.replaceState({ back: '/login' }, '', '/read/1/2?format=epub')
    setHistoryLength(1)
    const router = makeRouter()

    await exitReader(router)

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith({ name: 'dashboard' })
  })

  it('falls back to Dashboard instead of backing into login with redirect query', async () => {
    window.history.replaceState({ back: '/login?redirect=/read/1/2?format=epub' }, '', '/read/1/2?format=epub')
    setHistoryLength(1)
    const router = makeRouter()

    await exitReader(router)

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith({ name: 'dashboard' })
  })

  it('replaces with the intended exit route when stacked reader entries block a clean back', async () => {
    window.history.replaceState({ back: '/book/1?tab=details' }, '', '/read/1/2?format=epub')
    setHistoryLength(3)
    const router = makeRouter({ backStepsToExit: 999 })

    await exitReader(router)

    expect(router.back).toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith('/book/1?tab=details')
  })
})

describe('registerReaderReturnRoute', () => {
  function makeHarness() {
    const beforeEachHandlers: Array<
      (to: { path: string; fullPath: string; name?: string }, from: { path: string; fullPath: string; name?: string | null }) => unknown
    > = []
    const router = {
      beforeEach: (handler: (typeof beforeEachHandlers)[number]) => {
        beforeEachHandlers.push(handler)
      },
    } as unknown as Router

    registerReaderReturnRoute(router)
    return beforeEachHandlers[0]!
  }

  beforeEach(() => {
    sessionStorage.clear()
  })

  it('remembers the launch route when entering the reader', () => {
    const guard = makeHarness()
    guard({ path: '/read/1/2', fullPath: '/read/1/2?format=epub' }, { path: '/', fullPath: '/', name: 'dashboard' })
    expect(sessionStorage.getItem('reader:return-to')).toBe('/')
  })

  it('replaces duplicate reader opens when history already contains the same reader route', () => {
    window.history.replaceState({ back: '/read/1/2?format=epub' }, '', '/')
    const guard = makeHarness()
    const result = guard({ path: '/read/1/2', fullPath: '/read/1/2?format=epub' }, { path: '/', fullPath: '/', name: 'dashboard' })
    expect(result).toEqual({ path: '/read/1/2', fullPath: '/read/1/2?format=epub', replace: true })
  })

  it('redirects duplicate reader back navigation to the remembered route', () => {
    sessionStorage.setItem('reader:return-to', '/')
    const guard = makeHarness()
    const result = guard({ path: '/read/1/2', fullPath: '/read/1/2?format=epub' }, { path: '/read/1/2', fullPath: '/read/1/2?format=epub' })
    expect(result).toBe('/')
    expect(sessionStorage.getItem('reader:return-to')).toBeNull()
  })
})
