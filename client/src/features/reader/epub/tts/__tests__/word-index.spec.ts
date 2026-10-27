import { describe, expect, it, vi } from 'vitest'
import {
  TTS_ACTIVE_CLASS,
  TTS_SENTENCE_CLASS,
  buildWordIndex,
  clearTtsHighlight,
  findFirstVisibleWordIndex,
  findWordIndexAtPoint,
  isWordIndexVisible,
  highlightWord,
  injectTtsHighlightStyles,
  isActiveWordInStickyViewport,
  isActiveWordVisibleInViewport,
  scrollActiveWordIntoView,
  splitIntoSentences,
} from '../word-index'

describe('TTS word indexing', () => {
  it('wraps the active word and sentence words, then clears cleanly', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world. Another sentence.</p>'

    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)

    expect(words.map((entry) => entry.word)).toEqual(['Hello', 'world.', 'Another', 'sentence.'])
    expect(sentences).toHaveLength(1)
    expect(sentences[0]?.text).toBe('Hello world. Another sentence.')

    highlightWord(root, words, sentences, 1)

    expect(root.querySelectorAll(`.${TTS_SENTENCE_CLASS}`)).toHaveLength(1)
    expect(root.querySelector(`.${TTS_SENTENCE_CLASS}`)?.textContent).toBe('Hello world. Another sentence.')
    expect(root.querySelector(`.${TTS_ACTIVE_CLASS}`)?.textContent).toBe('world.')

    clearTtsHighlight(root)

    expect(root.querySelector(`.${TTS_SENTENCE_CLASS}`)).toBeNull()
    expect(root.textContent).toBe('Hello world. Another sentence.')
  })

  it('injects XHTML namespaced highlight nodes for EPUB chapter documents', () => {
    const xhtmlNs = 'http://www.w3.org/1999/xhtml'
    const doc = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><p>Hello world. Another sentence.</p></body></html>',
      'application/xhtml+xml',
    )
    const root = doc.getElementsByTagNameNS(xhtmlNs, 'body')[0] as HTMLElement

    injectTtsHighlightStyles(doc, '#fde68a', '#f59e0b')
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 1)

    const style = doc.getElementById('bookorbit-tts-highlight-style')
    const active = root.querySelector(`.${TTS_ACTIVE_CLASS}`)

    expect(style?.namespaceURI).toBe(xhtmlNs)
    expect(style?.textContent).toContain('background-color: #fde68a !important')
    expect(active?.namespaceURI).toBe(xhtmlNs)
    expect(active?.textContent).toBe('world.')
  })

  it('detects when the active word leaves the sticky follow band', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world. Another sentence.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 1)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    // Middle band for height 800 and ratio 0.42 is roughly y 232..568.
    active.getBoundingClientRect = () =>
      ({
        top: 390,
        bottom: 404,
        left: 0,
        right: 40,
        width: 40,
        height: 14,
        x: 0,
        y: 390,
        toJSON: () => ({}),
      }) as DOMRect

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    expect(isActiveWordInStickyViewport(root, 0.42)).toBe(true)

    active.getBoundingClientRect = () =>
      ({
        top: -40,
        bottom: -20,
        left: 0,
        right: 40,
        width: 40,
        height: 14,
        x: 0,
        y: -40,
        toJSON: () => ({}),
      }) as DOMRect
    expect(isActiveWordInStickyViewport(root, 0.42)).toBe(false)
  })

  it('treats any on-page word as visible for paginated follow tracking', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    // Foliate pads one blank page: first content page has start=size.
    // Visible content window is [start - size, start] = [0, 800] for start=800.
    // Near the trailing edge of the page — sticky band would fail; visibility should not.
    active.getBoundingClientRect = () =>
      ({
        top: 20,
        bottom: 34,
        left: 720,
        right: 760,
        width: 40,
        height: 14,
        x: 720,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect

    const foliate = { scrolled: false, size: 800, start: 800 }
    expect(isActiveWordVisibleInViewport(root, foliate)).toBe(true)
    expect(isActiveWordInStickyViewport(root, 0.42, foliate)).toBe(true)

    // Next page (iframe coords past `start`).
    active.getBoundingClientRect = () =>
      ({
        top: 20,
        bottom: 34,
        left: 900,
        right: 940,
        width: 40,
        height: 14,
        x: 900,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect
    expect(isActiveWordVisibleInViewport(root, foliate)).toBe(false)
  })

  it('scrolls the active highlight into view when requested', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    const scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions) => void>()
    active.scrollIntoView = scrollIntoView
    // Far below the viewport so keep-in-view must scroll.
    active.getBoundingClientRect = () =>
      ({
        top: 2000,
        bottom: 2016,
        left: 0,
        right: 40,
        width: 40,
        height: 16,
        x: 0,
        y: 2000,
        toJSON: () => ({}),
      }) as DOMRect
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })

    scrollActiveWordIntoView(root, 'instant', null)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  })

  it('does not scroll when the active word is already in the keep-in-view band', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    active.getBoundingClientRect = () =>
      ({
        top: 400,
        bottom: 416,
        left: 0,
        right: 40,
        width: 40,
        height: 16,
        x: 0,
        y: 400,
        toJSON: () => ({}),
      }) as DOMRect

    const scrollBy = vi.fn<(dx: number, dy: number) => void>()
    scrollActiveWordIntoView(root, 'instant', { scrolled: true, size: 800, scrollBy })
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('centers via foliate scrollBy when center mode is requested', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    active.getBoundingClientRect = () =>
      ({
        top: 400,
        bottom: 416,
        left: 0,
        right: 40,
        width: 40,
        height: 16,
        x: 0,
        y: 400,
        toJSON: () => ({}),
      }) as DOMRect

    const scrollBy = vi.fn<(dx: number, dy: number) => void>()
    scrollActiveWordIntoView(root, 'instant', { scrolled: true, size: 800, scrollBy }, { mode: 'center' })
    expect(scrollBy).toHaveBeenCalledWith(8, 0)
  })

  it('scrolls only when the word leaves the keep-in-view band', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    // Near the bottom of the viewport (trail threshold 0.82 * 800 = 656).
    active.getBoundingClientRect = () =>
      ({
        top: 700,
        bottom: 724,
        left: 0,
        right: 40,
        width: 40,
        height: 24,
        x: 0,
        y: 700,
        toJSON: () => ({}),
      }) as DOMRect

    const scrollBy = vi.fn<(dx: number, dy: number) => void>()
    // center = 712, target 0.36*800 = 288 → delta 424
    scrollActiveWordIntoView(root, 'instant', { scrolled: true, size: 800, start: 0, scrollBy })
    expect(scrollBy).toHaveBeenCalledWith(424, 0)
  })

  it('accounts for foliate scroll offset in scrolled mode with center mode', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    active.getBoundingClientRect = () =>
      ({
        top: 1415,
        bottom: 1439,
        left: 0,
        right: 40,
        width: 40,
        height: 24,
        x: 0,
        y: 1415,
        toJSON: () => ({}),
      }) as DOMRect

    const scrollBy = vi.fn<(dx: number, dy: number) => void>()
    scrollActiveWordIntoView(root, 'instant', { scrolled: true, size: 1268, start: 1415, scrollBy }, { mode: 'center' })
    expect(scrollBy).toHaveBeenCalledWith(-622, 0)
  })

  it('uses scrollToAnchor before scrollBy when the highlight is far off-screen', async () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    const foliate: {
      scrolled: boolean
      size: number
      start: number
      scrollBy: ReturnType<typeof vi.fn<(dx: number, dy: number) => void>>
      scrollToAnchor: ReturnType<typeof vi.fn<(anchor: Range | Element, select?: boolean) => Promise<void>>>
    } = {
      scrolled: true,
      size: 1268,
      start: 2861,
      scrollBy: vi.fn<(dx: number, dy: number) => void>(),
      scrollToAnchor: vi.fn<(anchor: Range | Element, select?: boolean) => Promise<void>>(async () => {
        foliate.start = 5343
      }),
    }

    active.getBoundingClientRect = () =>
      ({
        top: 5343,
        bottom: 5367,
        left: 0,
        right: 40,
        width: 40,
        height: 24,
        x: 5343,
        y: 5343,
        toJSON: () => ({}),
      }) as DOMRect

    scrollActiveWordIntoView(root, 'instant', foliate)
    await vi.waitFor(() => expect(foliate.scrollToAnchor).toHaveBeenCalledTimes(1))
    // keep-in-view target ratio 0.36 → delta = 12 - 1268*0.36 ≈ -444
    await vi.waitFor(() => expect(foliate.scrollBy).toHaveBeenCalledWith(expect.closeTo(-444, 0), 0))
  })

  it('paginated mode turns pages via scrollToAnchor only (never fractional scrollBy)', async () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    // First content page: start=size=400 → visible [0, 400]. Word on next page at left=520.
    active.getBoundingClientRect = () =>
      ({
        top: 20,
        bottom: 40,
        left: 520,
        right: 580,
        width: 60,
        height: 20,
        x: 520,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect

    const scrollBy = vi.fn<(dx: number, dy: number) => void>()
    const scrollToAnchor = vi.fn<(anchor: Range | Element, select?: boolean) => Promise<void>>(async () => {})
    scrollActiveWordIntoView(root, 'smooth', {
      scrolled: false,
      size: 400,
      start: 400,
      scrollBy,
      scrollToAnchor,
    })

    await vi.waitFor(() => expect(scrollToAnchor).toHaveBeenCalledTimes(1))
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('paginated mode does not scroll while the spoken word is still on this page', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    // First content page start=400, visible [0, 400]. Word near trailing edge still on-page.
    active.getBoundingClientRect = () =>
      ({
        top: 20,
        bottom: 40,
        left: 350,
        right: 390,
        width: 40,
        height: 20,
        x: 350,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect

    const scrollBy = vi.fn<(dx: number, dy: number) => void>()
    const scrollToAnchor = vi.fn<(anchor: Range | Element, select?: boolean) => Promise<void>>(async () => {})
    scrollActiveWordIntoView(root, 'smooth', {
      scrolled: false,
      size: 400,
      start: 400,
      scrollBy,
      scrollToAnchor,
    })

    expect(scrollToAnchor).not.toHaveBeenCalled()
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('paginated mode turns the page when highlight advances past start after the padding page', async () => {
    // Regression: old metrics used [start, start+size], which is the *next* page
    // under Foliate's blank-page padding, so next-page words looked "on page"
    // and auto page-turn never fired.
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    const size = 400
    // Second content page is on screen (start = 2 * size). Spoken word already on page 3.
    const start = size * 2
    active.getBoundingClientRect = () =>
      ({
        top: 24,
        bottom: 44,
        left: start + 40,
        right: start + 90,
        width: 50,
        height: 20,
        x: start + 40,
        y: 24,
        toJSON: () => ({}),
      }) as DOMRect

    const scrollBy = vi.fn<(dx: number, dy: number) => void>()
    const scrollToAnchor = vi.fn<(anchor: Range | Element, select?: boolean) => Promise<void>>(async () => {})
    scrollActiveWordIntoView(root, 'smooth', {
      scrolled: false,
      size,
      start,
      scrollBy,
      scrollToAnchor,
    })

    await vi.waitFor(() => expect(scrollToAnchor).toHaveBeenCalledTimes(1))
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('paginated vertical writing mode uses top/bottom for page-turn visibility', async () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    // Vertical paginated: start=size, visible top window [0, size]. Word below page.
    active.getBoundingClientRect = () =>
      ({
        top: 520,
        bottom: 560,
        left: 40,
        right: 80,
        width: 40,
        height: 40,
        x: 40,
        y: 520,
        toJSON: () => ({}),
      }) as DOMRect

    const scrollToAnchor = vi.fn<(anchor: Range | Element, select?: boolean) => Promise<void>>(async () => {})
    scrollActiveWordIntoView(root, 'smooth', {
      scrolled: false,
      vertical: true,
      size: 400,
      start: 400,
      scrollToAnchor,
    })

    await vi.waitFor(() => expect(scrollToAnchor).toHaveBeenCalledTimes(1))
  })

  it('uses foliate viewport metrics for sticky follow detection', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    active.getBoundingClientRect = () =>
      ({
        top: 1415,
        bottom: 1439,
        left: 0,
        right: 40,
        width: 40,
        height: 24,
        x: 0,
        y: 1415,
        toJSON: () => ({}),
      }) as DOMRect

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 18000 })
    expect(isActiveWordInStickyViewport(root, 0.42, { scrolled: true, size: 1268, start: 2683 })).toBe(false)
    expect(isActiveWordInStickyViewport(root, 0.42, { scrolled: true, size: 1268, start: 793 })).toBe(true)
  })

  it('finds the first word on the currently visible foliate page', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Alpha Bravo Charlie Delta</p>'
    const words = buildWordIndex(root)
    expect(words).toHaveLength(4)

    // Foliate pads one blank page: start=300, size=200 → visible content [100, 300].
    const rects: DOMRect[] = [
      // Off the previous page (left of the visible content window).
      { top: 20, bottom: 40, left: 20, right: 70, width: 50, height: 20, x: 20, y: 20, toJSON: () => ({}) } as DOMRect,
      { top: 20, bottom: 40, left: 40, right: 90, width: 50, height: 20, x: 40, y: 20, toJSON: () => ({}) } as DOMRect,
      // First word fully on the current page.
      { top: 20, bottom: 40, left: 120, right: 180, width: 60, height: 20, x: 120, y: 20, toJSON: () => ({}) } as DOMRect,
      { top: 20, bottom: 40, left: 200, right: 260, width: 60, height: 20, x: 200, y: 20, toJSON: () => ({}) } as DOMRect,
    ]

    let call = 0
    const original = Range.prototype.getBoundingClientRect
    Range.prototype.getBoundingClientRect = function () {
      return rects[Math.min(call++, rects.length - 1)]!
    }

    try {
      expect(findFirstVisibleWordIndex(root, words, { scrolled: false, size: 200, start: 300 })).toBe(2)
    } finally {
      Range.prototype.getBoundingClientRect = original
    }
  })

  it('detects whether a saved word is still on the current foliate page', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Alpha Bravo Charlie</p>'
    const words = buildWordIndex(root)
    // start=300, size=200 → visible content [100, 300].
    const rects: DOMRect[] = [
      { top: 20, bottom: 40, left: 20, right: 70, width: 50, height: 20, x: 20, y: 20, toJSON: () => ({}) } as DOMRect,
      { top: 20, bottom: 40, left: 120, right: 180, width: 60, height: 20, x: 120, y: 20, toJSON: () => ({}) } as DOMRect,
      { top: 20, bottom: 40, left: 200, right: 260, width: 60, height: 20, x: 200, y: 20, toJSON: () => ({}) } as DOMRect,
    ]
    const foliate = { scrolled: false, size: 200, start: 300 }
    const original = Range.prototype.getBoundingClientRect

    try {
      let nextRect = 0
      Range.prototype.getBoundingClientRect = function () {
        return rects[nextRect]!
      }

      nextRect = 0
      expect(isWordIndexVisible(root, words, 0, foliate)).toBe(false)
      nextRect = 1
      expect(isWordIndexVisible(root, words, 1, foliate)).toBe(true)
      nextRect = 2
      expect(isWordIndexVisible(root, words, 2, foliate)).toBe(true)
    } finally {
      Range.prototype.getBoundingClientRect = original
    }
  })

  it('falls back to the first document word when none are visible', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Only word</p>'
    const words = buildWordIndex(root)

    const original = Range.prototype.getBoundingClientRect
    Range.prototype.getBoundingClientRect = () =>
      ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    try {
      expect(findFirstVisibleWordIndex(root, words, { scrolled: false, size: 400, start: 0 })).toBe(0)
    } finally {
      Range.prototype.getBoundingClientRect = original
    }
  })

  it('finds a word index from a caret point inside text', () => {
    const doc = document.implementation.createHTMLDocument('Chapter')
    doc.body.innerHTML = '<main><p>Hello world.</p></main>'
    const root = doc.querySelector('main')!
    const textNode = root.querySelector('p')!.firstChild!
    const range = doc.createRange()
    range.setStart(textNode, 'Hello w'.length)
    range.collapse(true)
    Object.defineProperty(doc, 'caretRangeFromPoint', {
      configurable: true,
      value: () => range,
    })

    const words = buildWordIndex(root)

    expect(findWordIndexAtPoint(root, words, 12, 12)).toBe(1)
  })
})
