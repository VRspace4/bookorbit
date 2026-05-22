import { describe, expect, it, vi } from 'vitest'
import {
  TTS_ACTIVE_CLASS,
  TTS_SENTENCE_CLASS,
  buildWordIndex,
  clearTtsHighlight,
  findWordIndexAtPoint,
  highlightWord,
  injectTtsHighlightStyles,
  isActiveWordInStickyViewport,
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
    active.getBoundingClientRect = () =>
      ({
        top: 10,
        bottom: 24,
        left: 0,
        right: 40,
        width: 40,
        height: 14,
        x: 0,
        y: 10,
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

  it('scrolls the active highlight into view when requested', () => {
    const root = document.createElement('main')
    root.innerHTML = '<p>Hello world.</p>'
    const words = buildWordIndex(root)
    const sentences = splitIntoSentences(words, 0)
    highlightWord(root, words, sentences, 0)

    const active = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)!
    const scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions) => void>()
    active.scrollIntoView = scrollIntoView

    scrollActiveWordIntoView(root, 'instant', null)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'instant' })
  })

  it('centers via foliate scrollBy when a scrolled paginator is available', () => {
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
    expect(scrollBy).toHaveBeenCalledWith(8, 0)
  })

  it('accounts for foliate scroll offset in scrolled mode', () => {
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
    scrollActiveWordIntoView(root, 'instant', { scrolled: true, size: 1268, start: 1415, scrollBy })
    expect(scrollBy).toHaveBeenCalledWith(-622, 0)
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
