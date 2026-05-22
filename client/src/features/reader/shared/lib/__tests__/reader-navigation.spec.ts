import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'
import { exitReader, isReaderPath } from '../reader-navigation'

function makeRouter(): Router {
  return {
    back: vi.fn<() => void>(),
    replace: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  } as unknown as Router
}

describe('reader navigation', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/read/1/2?format=epub')
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

  it('falls back to Dashboard when the reader was opened without prior app history', async () => {
    window.history.replaceState({ back: null }, '', '/read/1/2?format=epub')
    const router = makeRouter()

    await exitReader(router)

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith({ name: 'dashboard' })
  })

  it('falls back to Dashboard instead of backing into another reader route', async () => {
    window.history.replaceState({ back: '/read/1/1?format=epub' }, '', '/read/1/2?format=epub')
    const router = makeRouter()

    await exitReader(router)

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith({ name: 'dashboard' })
  })

  it('falls back to Dashboard instead of backing into auth routes', async () => {
    window.history.replaceState({ back: '/login' }, '', '/read/1/2?format=epub')
    const router = makeRouter()

    await exitReader(router)

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith({ name: 'dashboard' })
  })
})
