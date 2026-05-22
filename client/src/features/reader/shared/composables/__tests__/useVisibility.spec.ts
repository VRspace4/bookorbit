import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isReaderDesktopViewport, useVisibility } from '../useVisibility'

function mountWithVisibility() {
  let visibility: ReturnType<typeof useVisibility> | undefined

  const wrapper = mount(
    defineComponent({
      setup() {
        visibility = useVisibility()
        return { visibility }
      },
      template: '<div />',
    }),
  )

  return { wrapper, visibility: visibility! }
}

function mockViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    writable: true,
    configurable: true,
  })

  window.matchMedia = vi.fn<(query: string) => MediaQueryList>().mockImplementation((query: string) => ({
    matches: query === '(min-width: 768px)' ? width >= 768 : false,
    media: query,
    addEventListener: vi.fn<() => void>(),
    removeEventListener: vi.fn<() => void>(),
    addListener: vi.fn<() => void>(),
    removeListener: vi.fn<() => void>(),
    dispatchEvent: vi.fn<() => boolean>(),
  })) as typeof window.matchMedia
}

describe('useVisibility', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows header and footer by default on desktop viewports', async () => {
    mockViewport(1024)
    const { visibility } = mountWithVisibility()

    await nextTick()

    expect(isReaderDesktopViewport()).toBe(true)
    expect(visibility.headerVisible.value).toBe(true)
    expect(visibility.footerVisible.value).toBe(true)
  })

  it('hides header and footer by default on mobile viewports', async () => {
    mockViewport(390)
    const { visibility } = mountWithVisibility()

    await nextTick()

    expect(isReaderDesktopViewport()).toBe(false)
    expect(visibility.headerVisible.value).toBe(false)
    expect(visibility.footerVisible.value).toBe(false)
  })

  it('pins chrome when middle-tapped on mobile', async () => {
    mockViewport(390)
    const { visibility } = mountWithVisibility()

    await nextTick()

    visibility.handleMiddleTap()

    expect(visibility.headerVisible.value).toBe(true)
    expect(visibility.footerVisible.value).toBe(true)

    visibility.handleMiddleTap()

    expect(visibility.headerVisible.value).toBe(false)
    expect(visibility.footerVisible.value).toBe(false)
  })

  it('does not auto-hide chrome on desktop after mount', async () => {
    mockViewport(1280)
    const { visibility } = mountWithVisibility()

    await nextTick()
    vi.advanceTimersByTime(5000)

    expect(visibility.headerVisible.value).toBe(true)
    expect(visibility.footerVisible.value).toBe(true)
  })

  it('keeps header visible while visibility is locked', async () => {
    mockViewport(390)
    const { visibility } = mountWithVisibility()

    await nextTick()

    visibility.setVisibilityLock(true)

    expect(visibility.headerVisible.value).toBe(true)

    visibility.setVisibilityLock(false)

    expect(visibility.headerVisible.value).toBe(false)
    expect(visibility.footerVisible.value).toBe(false)
  })
})
