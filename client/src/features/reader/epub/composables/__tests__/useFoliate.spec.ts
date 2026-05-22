import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<Response>>(),
  getAccessToken: vi.fn<() => string | null>(() => 'test-token'),
}))

vi.mock('../useFoliateAnnotations', () => ({
  useFoliateAnnotations: () => ({
    annotationStyleMap: new Map(),
    addAnnotation: vi.fn<() => void>(),
    addAnnotations: vi.fn<() => void>(),
    deleteAnnotation: vi.fn<() => void>(),
    reAddAll: vi.fn<() => void>(),
    handleDrawAnnotationEvent: vi.fn<() => void>(),
  }),
}))

vi.mock('../useFoliateSelection', () => ({
  useFoliateSelection: () => ({
    setHandler: vi.fn<() => void>(),
    handleSelectionEnd: vi.fn<() => void>(),
    handleSelectionChange: vi.fn<() => void>(),
  }),
}))

vi.mock('../useFoliateInput', () => ({
  useFoliateInput: () => ({
    cleanup: vi.fn<() => void>(),
    attachIframeClicks: vi.fn<() => void>(),
    attachViewTouches: vi.fn<() => void>(),
  }),
}))

import { api } from '@/lib/api'
import { useFoliate } from '../useFoliate'

describe('useFoliate.open', () => {
  let container: HTMLDivElement
  let mockGoTo: ReturnType<typeof vi.fn>
  let mockGoToFraction: ReturnType<typeof vi.fn>
  let loadHandlers: Array<(event: Event) => void>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    loadHandlers = []

    mockGoTo = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    mockGoToFraction = vi.fn<() => void>()

    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'foliate-view') {
        const el = originalCreateElement('div')
        Object.assign(el, {
          open: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
          goTo: mockGoTo,
          goToFraction: mockGoToFraction,
          addEventListener: vi.fn<(type: string, handler: (event: Event) => void) => void>((type, handler) => {
            if (type === 'load') loadHandlers.push(handler)
          }),
          renderer: {
            setAttribute: vi.fn<(name: string, value: string) => void>(),
            removeAttribute: vi.fn<(name: string) => void>(),
          },
          destroy: vi.fn<() => void>(),
        })
        return el
      }
      return originalCreateElement(tag)
    })

    vi.spyOn(customElements, 'get').mockReturnValue(class {} as CustomElementConstructor)

    vi.mocked(api).mockResolvedValue({
      ok: true,
      json: vi.fn<() => Promise<unknown>>().mockResolvedValue({}),
    } as unknown as Response)
    ;(window as { makeStreamingBook?: unknown }).makeStreamingBook = vi.fn<() => Promise<unknown>>().mockResolvedValue({ type: 'book' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    container.remove()
    delete (window as { makeStreamingBook?: unknown }).makeStreamingBook
  })

  async function dispatchLoad() {
    for (const handler of loadHandlers) {
      handler(new CustomEvent('load', { detail: { doc: document } }))
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('opens at position 0 to trigger the initial load event', async () => {
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', null, undefined)

    expect(mockGoTo).toHaveBeenCalledWith(0)
    expect(mockGoToFraction).not.toHaveBeenCalled()
  })

  it('restores CFI after the initial load event', async () => {
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', 'epubcfi(/6/2!)', undefined)
    mockGoTo.mockClear()

    await dispatchLoad()

    expect(mockGoTo).toHaveBeenCalledWith('epubcfi(/6/2!)')
    expect(mockGoToFraction).not.toHaveBeenCalled()
  })

  it('restores fallback fraction after the initial load event when cfi is null', async () => {
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', null, 0.42)
    mockGoTo.mockClear()

    await dispatchLoad()

    expect(mockGoTo).not.toHaveBeenCalled()
    expect(mockGoToFraction).toHaveBeenCalledWith(0.42)
  })

  it('does not restore when cfi is null and fraction is 0', async () => {
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', null, 0)
    mockGoTo.mockClear()

    await dispatchLoad()

    expect(mockGoTo).not.toHaveBeenCalled()
    expect(mockGoToFraction).not.toHaveBeenCalled()
  })

  it('falls back to fraction when CFI navigation fails after load', async () => {
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', 'epubcfi(/bad)', 0.75)
    mockGoTo.mockClear()
    mockGoTo.mockImplementation(async (target: string | number) => {
      if (typeof target === 'string') throw new Error('invalid CFI')
    })

    await dispatchLoad()

    expect(mockGoTo).toHaveBeenCalledWith('epubcfi(/bad)')
    expect(mockGoToFraction).toHaveBeenCalledWith(0.75)
  })

  it('does not call goTo or goToFraction when container is null', async () => {
    const foliate = useFoliate(() => null)

    await foliate.open(1, 1, 'epub', 'epubcfi(/6/2!)', 0.5)

    expect(mockGoTo).not.toHaveBeenCalled()
    expect(mockGoToFraction).not.toHaveBeenCalled()
  })
})
