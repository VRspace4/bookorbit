import { describe, expect, it } from 'vitest'
import {
  TTS_ACTIVE_CLASS,
  TTS_SENTENCE_CLASS,
  buildWordIndex,
  clearTtsHighlight,
  findWordIndexAtPoint,
  highlightWord,
  injectTtsHighlightStyles,
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
