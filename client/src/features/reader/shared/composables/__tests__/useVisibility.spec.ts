import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { isReaderDesktopViewport, useVisibility } from '../useVisibility'

function mountVisibility() {
  let visibility!: ReturnType<typeof useVisibility>
  const wrapper = mount(
    defineComponent({
      setup() {
        visibility = useVisibility()
        return () => h('div')
      },
    }),
  )

  return { visibility, wrapper }
}

describe('useVisibility', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('temporarily reveals unpinned controls from a middle tap', async () => {
    vi.useFakeTimers()
    const { visibility, wrapper } = mountVisibility()

    visibility.handleMiddleTap()

    expect(visibility.isPinned.value).toBe(false)
    expect(visibility.headerVisible.value).toBe(true)
    expect(visibility.footerVisible.value).toBe(true)

    await vi.advanceTimersByTimeAsync(3000)

    expect(visibility.headerVisible.value).toBe(false)
    expect(visibility.footerVisible.value).toBe(false)
    wrapper.unmount()
  })

  it('hides temporarily visible controls on the next middle tap', () => {
    vi.useFakeTimers()
    const { visibility, wrapper } = mountVisibility()

    visibility.handleMiddleTap()
    visibility.handleMiddleTap()

    expect(visibility.isPinned.value).toBe(false)
    expect(visibility.headerVisible.value).toBe(false)
    expect(visibility.footerVisible.value).toBe(false)
    wrapper.unmount()
  })

  it('keeps pinned controls visible until explicitly unpinned', async () => {
    vi.useFakeTimers()
    const { visibility, wrapper } = mountVisibility()

    visibility.handleMiddleTap()
    visibility.togglePinned()
    await vi.advanceTimersByTimeAsync(3000)

    expect(visibility.isPinned.value).toBe(true)
    expect(visibility.headerVisible.value).toBe(true)
    expect(visibility.footerVisible.value).toBe(true)

    visibility.handleMiddleTap()
    expect(visibility.headerVisible.value).toBe(true)
    expect(visibility.footerVisible.value).toBe(true)

    visibility.togglePinned()
    expect(visibility.isPinned.value).toBe(false)
    expect(visibility.headerVisible.value).toBe(true)
    expect(visibility.footerVisible.value).toBe(true)

    await vi.advanceTimersByTimeAsync(3000)
    expect(visibility.headerVisible.value).toBe(false)
    expect(visibility.footerVisible.value).toBe(false)
    wrapper.unmount()
  })
})

describe('useVisibility viewport defaults', () => {
  function stubViewport(width: number) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === '(min-width: 768px)' ? width >= 768 : false, media: query })),
    )
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts pinned with the chrome showing on desktop, and keeps it there', () => {
    vi.useFakeTimers()
    stubViewport(1280)
    const { visibility } = mountVisibility()

    vi.advanceTimersByTime(5000)

    expect(isReaderDesktopViewport()).toBe(true)
    expect(visibility.isPinned.value).toBe(true)
    expect(visibility.headerVisible.value).toBe(true)
    expect(visibility.footerVisible.value).toBe(true)
  })

  it('starts with the chrome hidden on phones', () => {
    stubViewport(390)
    const { visibility } = mountVisibility()

    expect(isReaderDesktopViewport()).toBe(false)
    expect(visibility.isPinned.value).toBe(false)
    expect(visibility.headerVisible.value).toBe(false)
    expect(visibility.footerVisible.value).toBe(false)
  })
})
