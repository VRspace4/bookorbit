export const TTS_SENTENCE_CLASS = 'bo-tts-sentence'
export const TTS_ACTIVE_CLASS = 'bo-tts-active'
const XHTML_NS = 'http://www.w3.org/1999/xhtml'

export interface WordEntry {
  word: string
  speakStart: number
  speakEnd: number
}

export interface SentenceInfo {
  text: string
  wordStartIdx: number
  wordEndIdxExclusive: number
}

const SKIP_SELECTOR = `script, style, svg, math, audio, video, [hidden], [aria-hidden="true"]`
const ABBREV_RE = /^(Dr|Mr|Mrs|Ms|St|Jr|Sr|vs|etc|e\.g|i\.e|a\.m|p\.m|U\.S|U\.K)\.$/i
const MIN_WORDS_PER_CHUNK = 3

function createContentElement<K extends keyof HTMLElementTagNameMap>(doc: Document, tagName: K): HTMLElementTagNameMap[K] {
  if (doc.documentElement?.namespaceURI === XHTML_NS || doc.contentType === 'application/xhtml+xml') {
    return doc.createElementNS(XHTML_NS, tagName) as HTMLElementTagNameMap[K]
  }
  return doc.createElement(tagName)
}

function isSkipped(node: Node): boolean {
  const parent = node.parentElement
  if (!parent) return true
  return !!parent.closest(SKIP_SELECTOR)
}

function walkTextNodes(root: HTMLElement, visit: (node: Text, text: string, cursor: number) => void | false) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (isSkipped(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  let cursor = 0
  let cur = walker.nextNode() as Text | null
  while (cur) {
    const text = cur.data
    const result = visit(cur, text, cursor)
    if (result === false) return
    cursor += text.length
    cur = walker.nextNode() as Text | null
  }
}

export function buildWordIndex(root: HTMLElement): WordEntry[] {
  clearTtsHighlight(root)
  const entries: WordEntry[] = []
  const wordRe = /\S+/g
  walkTextNodes(root, (_node, text, cursor) => {
    wordRe.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = wordRe.exec(text))) {
      entries.push({
        word: match[0],
        speakStart: cursor + match.index,
        speakEnd: cursor + match.index + match[0].length,
      })
    }
  })
  return entries
}

export function splitIntoSentences(words: WordEntry[], fromIdx: number): SentenceInfo[] {
  const raw: SentenceInfo[] = []
  let start = fromIdx
  for (let i = fromIdx; i < words.length; i++) {
    const word = words[i]?.word ?? ''
    const endsWithTerminator = /[.!?]+["')\]]*$/.test(word)
    const isAbbrev = ABBREV_RE.test(word)
    const isLast = i === words.length - 1
    if ((endsWithTerminator && !isAbbrev) || isLast) {
      raw.push({
        text: words
          .slice(start, i + 1)
          .map((entry) => entry.word)
          .join(' '),
        wordStartIdx: start,
        wordEndIdxExclusive: i + 1,
      })
      start = i + 1
    }
  }

  const merged: SentenceInfo[] = []
  for (const sentence of raw) {
    const wordCount = sentence.wordEndIdxExclusive - sentence.wordStartIdx
    if (wordCount < MIN_WORDS_PER_CHUNK && merged.length > 0) {
      const prev = merged[merged.length - 1]!
      merged[merged.length - 1] = {
        text: `${prev.text} ${sentence.text}`,
        wordStartIdx: prev.wordStartIdx,
        wordEndIdxExclusive: sentence.wordEndIdxExclusive,
      }
    } else {
      merged.push(sentence)
    }
  }
  return merged
}

export function findSentenceForWord(sentences: SentenceInfo[], wordIndex: number): SentenceInfo | null {
  return sentences.find((sentence) => wordIndex >= sentence.wordStartIdx && wordIndex < sentence.wordEndIdxExclusive) ?? null
}

export function makeRangeForWord(root: HTMLElement, entry: WordEntry): Range | null {
  let range: Range | null = null
  walkTextNodes(root, (node, text, cursor) => {
    const nodeEnd = cursor + text.length
    if (entry.speakStart >= cursor && entry.speakEnd <= nodeEnd) {
      range = root.ownerDocument.createRange()
      range.setStart(node, entry.speakStart - cursor)
      range.setEnd(node, entry.speakEnd - cursor)
      return false
    }
  })
  return range
}

function getCaretRangeFromPoint(doc: Document, clientX: number, clientY: number): Range | null {
  const docWithCaret = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  const range = docWithCaret.caretRangeFromPoint?.(clientX, clientY)
  if (range) return range

  const position = docWithCaret.caretPositionFromPoint?.(clientX, clientY)
  if (!position) return null

  const caretRange = doc.createRange()
  caretRange.setStart(position.offsetNode, position.offset)
  caretRange.collapse(true)
  return caretRange
}

function textCursorForRange(root: HTMLElement, range: Range): number | null {
  const container = range.startContainer
  const offset = range.startOffset
  let result: number | null = null
  walkTextNodes(root, (node, text, cursor) => {
    if (node === container) {
      result = cursor + Math.min(offset, text.length)
      return false
    }
  })
  return result
}

export function findWordIndexAtPoint(root: HTMLElement, entries: WordEntry[], clientX: number, clientY: number): number | null {
  for (let i = 0; i < entries.length; i++) {
    const range = makeRangeForWord(root, entries[i]!)
    if (!range) continue
    const rects = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : []
    if (rects.some((rect) => clientX >= rect.left - 2 && clientX <= rect.right + 2 && clientY >= rect.top - 2 && clientY <= rect.bottom + 2)) {
      return i
    }
  }

  const caretRange = getCaretRangeFromPoint(root.ownerDocument, clientX, clientY)
  const cursor = caretRange ? textCursorForRange(root, caretRange) : null
  if (cursor === null) return null

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (cursor >= entry.speakStart && cursor <= entry.speakEnd) return i
  }

  return null
}

export function findFirstVisibleWordIndex(root: HTMLElement, entries: WordEntry[]): number {
  const doc = root.ownerDocument
  const viewportHeight = doc.defaultView?.innerHeight ?? doc.documentElement.clientHeight
  for (let i = 0; i < entries.length; i++) {
    const range = makeRangeForWord(root, entries[i]!)
    const rect = range?.getBoundingClientRect()
    if (rect && rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= viewportHeight) {
      return i
    }
  }
  return 0
}

export function clearTtsHighlight(root: HTMLElement) {
  const spans = root.querySelectorAll<HTMLSpanElement>(`.${TTS_SENTENCE_CLASS}, .${TTS_ACTIVE_CLASS}`)
  spans.forEach((span) => {
    const parent = span.parentNode
    if (!parent) return
    while (span.firstChild) parent.insertBefore(span.firstChild, span)
    parent.removeChild(span)
  })
  root.normalize()
}

function wrapRangeWithClass(root: HTMLElement, node: Text, localStart: number, localEnd: number, className: string) {
  try {
    const range = root.ownerDocument.createRange()
    range.setStart(node, localStart)
    range.setEnd(node, localEnd)
    const span = createContentElement(root.ownerDocument, 'span')
    span.setAttribute('class', className)
    range.surroundContents(span)
  } catch {
    // Highlight failure should not interrupt playback.
  }
}

export function highlightWord(root: HTMLElement, entries: WordEntry[], sentences: SentenceInfo[], index: number) {
  clearTtsHighlight(root)
  const sentence = findSentenceForWord(sentences, index)
  if (!sentence) return

  interface SentenceSegment {
    node: Text
    localStart: number
    localEnd: number
  }

  const sentenceSegments: SentenceSegment[] = []
  walkTextNodes(root, (node, text, cursor) => {
    const nodeEnd = cursor + text.length
    let localStart: number | null = null
    let localEnd: number | null = null
    for (let i = sentence.wordStartIdx; i < sentence.wordEndIdxExclusive; i++) {
      const entry = entries[i]
      if (!entry) continue
      if (entry.speakStart >= cursor && entry.speakEnd <= nodeEnd) {
        const start = entry.speakStart - cursor
        const end = entry.speakEnd - cursor
        localStart = localStart === null ? start : Math.min(localStart, start)
        localEnd = localEnd === null ? end : Math.max(localEnd, end)
      }
    }
    if (localStart !== null && localEnd !== null) {
      sentenceSegments.push({ node, localStart, localEnd })
    }
  })

  for (let i = sentenceSegments.length - 1; i >= 0; i--) {
    const segment = sentenceSegments[i]!
    wrapRangeWithClass(root, segment.node, segment.localStart, segment.localEnd, TTS_SENTENCE_CLASS)
  }

  const activeEntry = entries[index]
  if (activeEntry) {
    walkTextNodes(root, (node, text, cursor) => {
      const nodeEnd = cursor + text.length
      if (activeEntry.speakStart >= cursor && activeEntry.speakEnd <= nodeEnd) {
        wrapRangeWithClass(root, node, activeEntry.speakStart - cursor, activeEntry.speakEnd - cursor, TTS_ACTIVE_CLASS)
        return false
      }
    })
  }

  const activeEl = root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)
  activeEl?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' })
}

export function injectTtsHighlightStyles(doc: Document, sentenceColor: string, wordColor: string) {
  const id = 'bookorbit-tts-highlight-style'
  const existing = doc.getElementById(id) ?? doc.querySelector<HTMLElement>(`#${id}`)
  const css = `
    .${TTS_SENTENCE_CLASS} {
      background-color: ${sentenceColor} !important;
      background-color: color-mix(in srgb, ${sentenceColor} 62%, transparent) !important;
      border-radius: 0.2em;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      transition: background 120ms ease-out;
    }
    .${TTS_ACTIVE_CLASS} {
      background-color: ${wordColor} !important;
      border-radius: 0.12em;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      color: inherit !important;
      outline: 1px solid ${wordColor} !important;
      outline-color: color-mix(in srgb, ${wordColor} 70%, transparent) !important;
      outline-offset: 1px;
    }
  `
  if (existing) {
    existing.textContent = css
    return
  }
  const style = createContentElement(doc, 'style')
  style.id = id
  style.setAttribute('type', 'text/css')
  style.textContent = css
  ;(doc.head ?? doc.documentElement).appendChild(style)
}
