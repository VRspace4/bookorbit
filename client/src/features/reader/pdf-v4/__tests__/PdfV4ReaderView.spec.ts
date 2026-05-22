import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import type { PDFViewerConfig } from '@embedpdf/vue-pdf-viewer'

const mockProgressLoad = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockProgressSave = vi.fn<() => void>()
const mockProgressPageNumber = { value: 5 }
const mockProgressPercentage = { value: 25 }
const mockProgressPositionSeconds = { value: null as number | null }

const mockProgressScheduleSave = vi.fn<() => void>()
const mockProgressFlush = vi.fn<() => void>()
const mockRouterBack = vi.fn<() => void>()
const mockRouterReplace = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

vi.mock('../../shared/composables/useReaderProgress', () => ({
  useReaderProgress: () => ({
    load: mockProgressLoad,
    save: mockProgressSave,
    scheduleSave: mockProgressScheduleSave,
    flush: mockProgressFlush,
    pageNumber: mockProgressPageNumber,
    percentage: mockProgressPercentage,
    positionSeconds: mockProgressPositionSeconds,
  }),
}))

const mockSettingsLoad = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockUpdateBookSettings = vi.fn<() => void>()
const mockEffective = {
  value: {
    scrollMode: 'vertical' as string,
    spread: 'none' as string,
    zoomMode: 'fit-page' as string,
    customScale: 1.0,
    rotation: 0 as number,
  },
}

vi.mock('../../shared/composables/useReaderSettings', () => ({
  useReaderSettings: () => ({
    load: mockSettingsLoad,
    updateBookSettings: mockUpdateBookSettings,
    effective: mockEffective,
  }),
}))

const mockOnActivity = vi.fn<() => void>()
vi.mock('../../shared/composables/useReadingSession', () => ({
  useReadingSession: () => ({
    onActivity: mockOnActivity,
  }),
}))

vi.mock('@/lib/api', () => ({
  getAccessToken: () => 'test-token-abc',
}))

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn<() => void>(),
  useRouter: () => ({
    back: mockRouterBack,
    replace: mockRouterReplace,
  }),
}))

let capturedConfig: PDFViewerConfig | null = null
let readyCallback: ((registry: unknown) => void) | null = null
let initCallback: ((container: unknown) => void) | null = null

vi.mock('@embedpdf/vue-pdf-viewer', () => ({
  PDFViewer: defineComponent({
    props: ['config'],
    emits: ['ready', 'init'],
    setup(props, { emit }) {
      capturedConfig = props.config
      readyCallback = (registry: unknown) => emit('ready', registry)
      initCallback = (container: unknown) => emit('init', container)
      return () => h('div', { class: 'mock-pdf-viewer' })
    },
  }),
  ScrollPlugin: { id: 'scroll' },
  ScrollStrategy: { Vertical: 'vertical', Horizontal: 'horizontal' },
  SpreadMode: { None: 'none', Odd: 'odd', Even: 'even' },
  ZoomMode: { Automatic: 'automatic', FitPage: 'fit-page', FitWidth: 'fit-width' },
  ViewportPlugin: { id: 'viewport' },
}))

function createScrollCapability(overrides: Record<string, unknown> = {}) {
  return {
    onLayoutReady: vi.fn<(handler: (e: { isInitial: boolean; totalPages: number }) => void) => () => void>((handler) => {
      void handler
      return () => {}
    }),
    onLayoutChange: vi.fn<(handler: () => void) => () => void>((handler) => {
      void handler
      return () => {}
    }),
    onPageChange: vi.fn<(handler: (e: { pageNumber: number; totalPages: number }) => void) => () => void>((handler) => {
      void handler
      return () => {}
    }),
    onScroll: vi.fn<(handler: (e: { currentPage: number; scrollOffset?: { y: number } }) => void) => () => void>((handler) => {
      void handler
      return () => {}
    }),
    onStateChange: vi.fn<(handler: (state: { strategy?: string }) => void) => () => void>((handler) => {
      void handler
      return () => {}
    }),
    scrollToPage: vi.fn<() => void>(),
    getTotalPages: () => 20,
    getMetrics: () => ({ currentPage: 5, scrollOffset: { y: 0 } }),
    ...overrides,
  }
}

function createMockRegistry(scrollOverrides: Record<string, unknown> = {}) {
  return {
    getPlugin: (id: string) => ({
      provides: () => {
        if (id === 'viewport') {
          return { scrollTo: vi.fn<() => void>() }
        }
        return createScrollCapability(scrollOverrides)
      },
    }),
  }
}

// Must import AFTER mocks are set up
const { default: PdfV4ReaderView } = await import('../PdfV4ReaderView.vue')

describe('PdfV4ReaderView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedConfig = null
    readyCallback = null
    initCallback = null
    document.documentElement.className = ''
    window.history.replaceState(null, '', '/read/42/101?format=pdf')
    localStorage.clear()
    mockProgressPageNumber.value = 5
    mockProgressPositionSeconds.value = null
    setActivePinia(createPinia())
  })

  async function mountComponent() {
    const pinia = createPinia()
    const wrapper = mount(PdfV4ReaderView, {
      props: { bookId: 42, fileId: 101 },
      global: { plugins: [pinia] },
    })
    await flushPromises()
    await nextTick()
    return wrapper
  }

  describe('initialization', () => {
    it('loads book settings on mount', async () => {
      await mountComponent()
      expect(mockSettingsLoad).toHaveBeenCalled()
    })

    it('renders viewer only after config is ready', async () => {
      const wrapper = await mountComponent()
      expect(wrapper.find('.mock-pdf-viewer').exists()).toBe(true)
    })
  })

  describe('config construction', () => {
    it('sets tabBar to never', async () => {
      await mountComponent()
      expect(capturedConfig?.tabBar).toBe('never')
    })

    it('disables annotation, signature, form, print, export, insert, and redaction categories', async () => {
      await mountComponent()
      expect(capturedConfig?.disabledCategories).toEqual(
        expect.arrayContaining(['annotation', 'signature', 'form', 'document-print', 'export', 'insert', 'redaction']),
      )
    })

    it('includes auth header in document request options', async () => {
      await mountComponent()
      const docs = capturedConfig?.documentManager?.initialDocuments
      expect(docs).toHaveLength(1)
      const doc = docs?.[0] as Record<string, unknown> | undefined
      expect((doc?.requestOptions as Record<string, unknown>)?.headers).toEqual({
        Authorization: 'Bearer test-token-abc',
      })
    })

    it('sets document URL using fileId prop', async () => {
      await mountComponent()
      const docs = capturedConfig?.documentManager?.initialDocuments
      const doc = docs?.[0] as Record<string, unknown> | undefined
      expect(doc?.url).toBe('/api/v1/books/files/101/serve')
    })

    it('maps scroll mode from settings', async () => {
      mockEffective.value.scrollMode = 'horizontal'
      await mountComponent()
      expect(capturedConfig?.scroll?.defaultStrategy).toBe('horizontal')
      mockEffective.value.scrollMode = 'vertical'
    })

    it('maps spread mode from settings', async () => {
      mockEffective.value.spread = 'odd'
      await mountComponent()
      expect(capturedConfig?.spread?.defaultSpreadMode).toBe('odd')
      mockEffective.value.spread = 'none'
    })

    it('maps fit-page zoom from settings', async () => {
      mockEffective.value.zoomMode = 'fit-page'
      await mountComponent()
      expect(capturedConfig?.zoom?.defaultZoomLevel).toBe('fit-page')
    })

    it('maps custom zoom scale from settings', async () => {
      mockEffective.value.zoomMode = 'custom'
      mockEffective.value.customScale = 1.5
      await mountComponent()
      expect(capturedConfig?.zoom?.defaultZoomLevel).toBe(1.5)
      mockEffective.value.zoomMode = 'fit-page'
      mockEffective.value.customScale = 1.0
    })
  })

  describe('theme configuration', () => {
    it('sets light preference when not in dark mode', async () => {
      localStorage.setItem('theme', JSON.stringify('light'))
      await mountComponent()
      expect(capturedConfig?.theme?.preference).toBe('light')
    })

    it('sets dark preference when in dark mode', async () => {
      document.documentElement.classList.add('dark')
      await mountComponent()
      expect(capturedConfig?.theme?.preference).toBe('dark')
    })

    it('includes accent color overrides from theme store', async () => {
      await mountComponent()
      expect(capturedConfig?.theme?.light?.accent?.primary).toBeDefined()
      expect(capturedConfig?.theme?.dark?.accent?.primary).toBeDefined()
      expect(capturedConfig?.theme?.light?.accent?.primary).toBe(capturedConfig?.theme?.dark?.accent?.primary)
    })

    it('syncs theme on class attribute change via setTheme', async () => {
      const mockSetTheme = vi.fn<() => void>()
      const mockContainer = { setTheme: mockSetTheme }

      await mountComponent()
      initCallback?.(mockContainer)

      const mockRegistry = createMockRegistry()
      readyCallback?.(mockRegistry)
      await flushPromises()

      document.documentElement.classList.add('dark')
      await flushPromises()
      await new Promise((r) => setTimeout(r, 50))

      expect(mockSetTheme).toHaveBeenCalledWith(expect.objectContaining({ preference: 'dark' }))
    })
  })

  describe('progress tracking', () => {
    it('loads progress when viewer becomes ready', async () => {
      await mountComponent()
      readyCallback?.(createMockRegistry())
      await flushPromises()
      expect(mockProgressLoad).toHaveBeenCalled()
    })

    it('scrolls to saved page on layout ready', async () => {
      const mockScrollToPage = vi.fn<() => void>()
      const layoutReadyHandlers: ((event: { isInitial: boolean; totalPages: number }) => void)[] = []
      const mockRegistry = createMockRegistry({
        onLayoutReady: (handler: (e: { isInitial: boolean; totalPages: number }) => void) => {
          layoutReadyHandlers.push(handler)
          return () => {}
        },
        scrollToPage: mockScrollToPage,
      })

      await mountComponent()
      readyCallback?.(mockRegistry)
      await flushPromises()

      layoutReadyHandlers[0]?.({ isInitial: true, totalPages: 20 })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      expect(mockScrollToPage).toHaveBeenCalledWith({ pageNumber: 5, behavior: 'instant' })
    })

    it('does not save progress before restore completes', async () => {
      const layoutReadyHandlers: ((event: { isInitial: boolean; totalPages: number }) => void)[] = []
      const pageChangeHandlers: ((event: { pageNumber: number; totalPages: number }) => void)[] = []
      const mockRegistry = createMockRegistry({
        onLayoutReady: (handler: (e: { isInitial: boolean; totalPages: number }) => void) => {
          layoutReadyHandlers.push(handler)
          return () => {}
        },
        onPageChange: (handler: (e: { pageNumber: number; totalPages: number }) => void) => {
          pageChangeHandlers.push(handler)
          return () => {}
        },
        getMetrics: () => ({ currentPage: 1, scrollOffset: { y: 0 } }),
      })

      await mountComponent()
      readyCallback?.(mockRegistry)
      await flushPromises()

      pageChangeHandlers[0]?.({ pageNumber: 1, totalPages: 20 })
      expect(mockProgressScheduleSave).not.toHaveBeenCalled()

      layoutReadyHandlers[0]?.({ isInitial: true, totalPages: 20 })
      await flushPromises()
    })

    it('allows lower pages to save after the initial restore completes', async () => {
      const layoutReadyHandlers: ((event: { isInitial: boolean; totalPages: number }) => void)[] = []
      const pageChangeHandlers: ((event: { pageNumber: number; totalPages: number }) => void)[] = []
      const mockRegistry = createMockRegistry({
        onLayoutReady: (handler: (e: { isInitial: boolean; totalPages: number }) => void) => {
          layoutReadyHandlers.push(handler)
          return () => {}
        },
        onPageChange: (handler: (e: { pageNumber: number; totalPages: number }) => void) => {
          pageChangeHandlers.push(handler)
          return () => {}
        },
        getMetrics: () => ({ currentPage: 5, scrollOffset: { y: 0 } }),
      })

      await mountComponent()
      readyCallback?.(mockRegistry)
      await flushPromises()

      layoutReadyHandlers[0]?.({ isInitial: true, totalPages: 20 })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))

      pageChangeHandlers[0]?.({ pageNumber: 3, totalPages: 20 })
      expect(mockProgressPageNumber.value).toBe(3)
      expect(mockProgressScheduleSave).toHaveBeenCalled()
    })

    it('does not scroll if saved page is 1', async () => {
      mockProgressPageNumber.value = 1
      const mockScrollToPage = vi.fn<() => void>()
      const layoutReadyHandlers: ((event: { isInitial: boolean; totalPages: number }) => void)[] = []
      const mockRegistry = createMockRegistry({
        onLayoutReady: (handler: (e: { isInitial: boolean; totalPages: number }) => void) => {
          layoutReadyHandlers.push(handler)
          return () => {}
        },
        scrollToPage: mockScrollToPage,
      })

      await mountComponent()
      readyCallback?.(mockRegistry)
      await flushPromises()

      layoutReadyHandlers[0]?.({ isInitial: true, totalPages: 20 })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      expect(mockScrollToPage).not.toHaveBeenCalled()
      mockProgressPageNumber.value = 5
    })

    it('calls onActivity on page change', async () => {
      mockProgressPageNumber.value = 1
      const pageChangeHandlers: ((event: { pageNumber: number; totalPages: number }) => void)[] = []
      const mockRegistry = createMockRegistry({
        onPageChange: (handler: (e: { pageNumber: number; totalPages: number }) => void) => {
          pageChangeHandlers.push(handler)
          return () => {}
        },
      })

      await mountComponent()
      readyCallback?.(mockRegistry)
      await flushPromises()

      pageChangeHandlers[0]?.({ pageNumber: 3, totalPages: 10 })
      expect(mockOnActivity).toHaveBeenCalled()
    })
  })

  describe('navigation', () => {
    it('flushes progress and returns to the previous page from the exit button', async () => {
      window.history.replaceState({ back: '/book/42?tab=details' }, '', '/read/42/101?format=pdf')
      const wrapper = await mountComponent()

      await wrapper.get('button[aria-label="Exit reader"]').trigger('click')
      await flushPromises()

      expect(mockProgressFlush).toHaveBeenCalled()
      expect(mockRouterBack).toHaveBeenCalled()
      expect(mockRouterReplace).not.toHaveBeenCalled()
    })

    it('flushes progress and falls back to Dashboard when there is no reader history', async () => {
      const wrapper = await mountComponent()

      await wrapper.get('button[aria-label="Exit reader"]').trigger('click')
      await flushPromises()

      expect(mockProgressFlush).toHaveBeenCalled()
      expect(mockRouterBack).not.toHaveBeenCalled()
      expect(mockRouterReplace).toHaveBeenCalledWith({ name: 'dashboard' })
    })
  })

  describe('cleanup', () => {
    it('disconnects mutation observer on unmount', async () => {
      const wrapper = await mountComponent()
      readyCallback?.(createMockRegistry())
      await flushPromises()

      expect(() => wrapper.unmount()).not.toThrow()
    })
  })
})
