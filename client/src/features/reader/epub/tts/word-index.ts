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

function isRectVisibleInReadingViewport(
  rect: DOMRect,
  root: HTMLElement,
  foliate?: FoliateScrollRenderer | null,
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false

  const hasFoliateViewport = Boolean(foliate && typeof foliate.size === 'number' && foliate.size > 0)
  if (hasFoliateViewport) {
    return getActiveWordViewportMetrics(rect, foliate!).visible
  }

  const doc = root.ownerDocument
  const viewportHeight = doc.defaultView?.innerHeight ?? doc.documentElement.clientHeight
  return rect.bottom >= 0 && rect.top <= viewportHeight
}

/** True when the given word index intersects the currently visible page/viewport. */
export function isWordIndexVisible(
  root: HTMLElement,
  entries: WordEntry[],
  wordIndex: number,
  foliate?: FoliateScrollRenderer | null,
): boolean {
  const entry = entries[wordIndex]
  if (!entry) return false
  const range = makeRangeForWord(root, entry)
  const rect = range?.getBoundingClientRect()
  if (!rect) return false
  return isRectVisibleInReadingViewport(rect, root, foliate)
}

/**
 * First word that intersects the currently visible reading page/viewport.
 * When a Foliate renderer is provided, uses paginated/scrolled metrics so
 * mid-chapter pages start from the visible page rather than the section top.
 */
export function findFirstVisibleWordIndex(
  root: HTMLElement,
  entries: WordEntry[],
  foliate?: FoliateScrollRenderer | null,
): number {
  for (let i = 0; i < entries.length; i++) {
    const range = makeRangeForWord(root, entries[i]!)
    const rect = range?.getBoundingClientRect()
    if (!rect) continue
    if (isRectVisibleInReadingViewport(rect, root, foliate)) return i
  }
  return 0
}

/**
 * Pin a word Range as Foliate's layout `#anchor`, then for paginated flow fine-tune
 * so the word sits at the leading edge of the content window (not merely somewhere
 * on the snapped page). Required after content-height changes: page-snap alone
 * leaves the anchor word mid-page once columns reflow.
 */
export async function pinWordRangeAsViewportLead(
  range: Range,
  foliate?: FoliateScrollRenderer | null,
): Promise<boolean> {
  if (!foliate || typeof foliate.scrollToAnchor !== 'function') return false

  try {
    await foliate.scrollToAnchor(range, false)
  } catch {
    return false
  }

  // Scrolled flow: scrollToAnchor already aligns the rect to the viewport start.
  if (foliate.scrolled === true) return true
  if (typeof foliate.scrollBy !== 'function') return true
  if (!(typeof foliate.size === 'number' && foliate.size > 0)) return true

  // Fine-tune after page-snap. Prefer rAF so layout is current; fall back for
  // environments where rAF is delayed/absent (some unit-test runners).
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => finish())
    }
    setTimeout(finish, 0)
  })

  const rect = range.getBoundingClientRect()
  if (!rect || (rect.width <= 0 && rect.height <= 0)) return true

  const start = foliate.start ?? 0
  const viewportSize = foliate.size
  // Paginated content window is [start - size, start] (blank padding page).
  const viewStart = start - viewportSize
  const axisStart = foliate.vertical ? rect.top : rect.left
  // Nudge so the word's leading edge meets the content window lead.
  let delta = axisStart - viewStart
  // Tiny pad so the first glyph is not flush-clipped by column edges.
  delta -= 2

  if (Math.abs(delta) < 2) return true

  // scrollBy is clamped to about one page by Foliate's scroll bounds.
  const maxStep = viewportSize * 0.98
  if (Math.abs(delta) > maxStep) {
    delta = Math.sign(delta) * maxStep
  }

  if (foliate.vertical) {
    foliate.scrollBy(0, delta)
  } else {
    foliate.scrollBy(delta, 0)
  }
  return true
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
}

export function getActiveHighlightElement(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(`.${TTS_ACTIVE_CLASS}`)
}

export interface FoliateScrollRenderer {
  scrolled?: boolean
  size?: number
  /** Foliate paginator scroll offset on the primary reading axis. */
  start?: number
  /**
   * When true, the primary reading axis is vertical (vertical writing mode in
   * paginated flow, or horizontal writing in scrolled flow). Used so visibility
   * checks read top/bottom instead of left/right for paginated layout.
   */
  vertical?: boolean
  scrollBy?: (dx: number, dy: number) => void
  scrollToAnchor?: (anchor: Range | Element, select?: boolean) => Promise<void>
}

/**
 * Foliate paginated layout pads one blank page before content, so the visible
 * content window is `[start - size, start]` (LTR), not `[start, start + size]`.
 * Word rects are in iframe layout coordinates (column positions), matching
 * Foliate's `#getVisibleRange` / `#scrollToRect` math.
 */
function getActiveWordViewportMetrics(rect: DOMRect, foliate: FoliateScrollRenderer) {
  const start = foliate.start ?? 0
  const viewportSize = foliate.size ?? 0

  if (foliate.scrolled) {
    const top = rect.top - start
    const bottom = rect.bottom - start
    return {
      viewportSize,
      center: top + rect.height / 2,
      visible: bottom > 0 && top < viewportSize,
    }
  }

  // Paginated: axis is horizontal (left/right) unless vertical writing mode.
  const axisStart = foliate.vertical ? rect.top : rect.left
  const axisEnd = foliate.vertical ? rect.bottom : rect.right
  const axisSize = foliate.vertical ? rect.height : rect.width
  // Blank padding page shifts the content window one page behind `start`.
  const viewStart = start - viewportSize
  const viewEnd = start
  return {
    viewportSize,
    center: axisStart + axisSize / 2 - viewStart,
    visible: axisEnd > viewStart && axisStart < viewEnd,
  }
}

const foliateScrollAnimations = new WeakMap<object, number>()

function scrollFoliateBy(foliate: FoliateScrollRenderer, delta: number, behavior: ScrollBehavior) {
  if (Math.abs(delta) < 2 || typeof foliate.scrollBy !== 'function') return

  const animationKey = foliate as object
  const existingFrame = foliateScrollAnimations.get(animationKey)
  if (existingFrame !== undefined) cancelAnimationFrame(existingFrame)

  if (behavior !== 'smooth') {
    foliate.scrollBy(delta, 0)
    foliateScrollAnimations.delete(animationKey)
    return
  }

  const durationMs = 280
  const startedAt = performance.now()
  let appliedDelta = 0

  const tick = (now: number) => {
    const t = Math.min(1, (now - startedAt) / durationMs)
    const eased = 1 - Math.pow(1 - t, 3)
    const targetDelta = delta * eased
    foliate.scrollBy?.(targetDelta - appliedDelta, 0)
    appliedDelta = targetDelta

    if (t < 1) {
      foliateScrollAnimations.set(animationKey, requestAnimationFrame(tick))
    } else {
      foliateScrollAnimations.delete(animationKey)
    }
  }

  foliateScrollAnimations.set(animationKey, requestAnimationFrame(tick))
}

function rangeForActiveElement(activeEl: HTMLElement): Range {
  const range = activeEl.ownerDocument.createRange()
  range.selectNodeContents(activeEl)
  return range
}

export type TtsScrollMode = 'center' | 'keep-in-view'

export interface ScrollActiveWordOptions {
  /**
   * `keep-in-view` (default): only scroll when the active word leaves a comfortable
   * reading band — avoids re-centering every word (which thrashing pages).
   * `center`: always put the word in the middle (explicit "follow along" jumps).
   */
  mode?: TtsScrollMode
}

/** Leading/trailing fractions of the viewport that count as "comfortable" without scrolling. */
const KEEP_IN_VIEW_LEAD = 0.06
const KEEP_IN_VIEW_TRAIL = 0.82
/**
 * When we do scroll, place the word this far from the leading edge.
 * Keep this inside the sticky follow band (~0.29–0.71) so auto-follow isn't immediately detached.
 */
const KEEP_IN_VIEW_TARGET = 0.36

function computeScrollDelta(activeEl: HTMLElement, foliate: FoliateScrollRenderer, targetRatio: number): number {
  const rect = activeEl.getBoundingClientRect()
  const { center, viewportSize } = getActiveWordViewportMetrics(rect, foliate)
  return center - viewportSize * targetRatio
}

function computeCenterDelta(activeEl: HTMLElement, foliate: FoliateScrollRenderer): number {
  return computeScrollDelta(activeEl, foliate, 0.5)
}

function isPaginatedFoliate(foliate: FoliateScrollRenderer): boolean {
  return foliate.scrolled !== true
}

function wordNeedsKeepInViewScroll(activeEl: HTMLElement, foliate: FoliateScrollRenderer): boolean {
  const rect = activeEl.getBoundingClientRect()
  const { center, viewportSize, visible } = getActiveWordViewportMetrics(rect, foliate)
  // Paginated layout is whole pages: only turn when the spoken word leaves this page.
  // Fractional scrollBy would leave the view stuck between two pages.
  if (isPaginatedFoliate(foliate)) {
    return !visible || viewportSize <= 0
  }
  if (!visible || viewportSize <= 0) return true
  const lead = viewportSize * KEEP_IN_VIEW_LEAD
  const trail = viewportSize * KEEP_IN_VIEW_TRAIL
  return center < lead || center > trail
}

/** Foliate scrollBy is clamped to a local window; large jumps need scrollToAnchor first. */
function needsAnchorScroll(activeEl: HTMLElement, foliate: FoliateScrollRenderer, targetRatio: number): boolean {
  const rect = activeEl.getBoundingClientRect()
  const { visible, viewportSize } = getActiveWordViewportMetrics(rect, foliate)
  if (!visible) return true
  // Paginated mode always uses full-page anchors (never mid-page deltas).
  if (isPaginatedFoliate(foliate)) return true
  return Math.abs(computeScrollDelta(activeEl, foliate, targetRatio)) > viewportSize * 0.55
}

function cancelFoliateScrollAnimation(foliate: FoliateScrollRenderer) {
  const animationKey = foliate as object
  const existingFrame = foliateScrollAnimations.get(animationKey)
  if (existingFrame !== undefined) {
    cancelAnimationFrame(existingFrame)
    foliateScrollAnimations.delete(animationKey)
  }
}

async function applyFoliateScroll(
  activeEl: HTMLElement,
  foliate: FoliateScrollRenderer,
  behavior: ScrollBehavior,
  targetRatio: number,
) {
  // Paginated: only snap to the page that contains the word. Never fractional scrollBy —
  // that freezes the reader between two pages.
  if (isPaginatedFoliate(foliate)) {
    cancelFoliateScrollAnimation(foliate)
    if (typeof foliate.scrollToAnchor === 'function') {
      await foliate.scrollToAnchor(rangeForActiveElement(activeEl), false)
    }
    return
  }

  if (needsAnchorScroll(activeEl, foliate, targetRatio) && typeof foliate.scrollToAnchor === 'function') {
    await foliate.scrollToAnchor(rangeForActiveElement(activeEl), false)
  }
  scrollFoliateBy(foliate, computeScrollDelta(activeEl, foliate, targetRatio), behavior)
}

export function scrollActiveWordIntoView(
  root: HTMLElement,
  behavior: ScrollBehavior = 'smooth',
  foliate?: FoliateScrollRenderer | null,
  options?: ScrollActiveWordOptions,
) {
  const activeEl = getActiveHighlightElement(root)
  if (!activeEl) return

  const mode: TtsScrollMode = options?.mode ?? 'keep-in-view'
  const targetRatio = mode === 'center' ? 0.5 : KEEP_IN_VIEW_TARGET

  if (foliate && typeof foliate.size === 'number' && foliate.size > 0) {
    if (mode === 'keep-in-view' && !wordNeedsKeepInViewScroll(activeEl, foliate)) {
      return
    }

    // Paginated layout: page-turn via scrollToAnchor only (works without scrollBy).
    if (isPaginatedFoliate(foliate)) {
      if (typeof foliate.scrollToAnchor === 'function') {
        void applyFoliateScroll(activeEl, foliate, 'instant', targetRatio)
      }
      return
    }

    if (typeof foliate.scrollBy !== 'function') return

    // Scrolled layout: page turns / large jumps instant; small keep-in-view adjusts can be smooth.
    const effectiveBehavior: ScrollBehavior =
      mode === 'keep-in-view' && needsAnchorScroll(activeEl, foliate, targetRatio) ? 'instant' : behavior
    void applyFoliateScroll(activeEl, foliate, effectiveBehavior, targetRatio)
    return
  }

  if (mode === 'keep-in-view') {
    const rect = activeEl.getBoundingClientRect()
    const win = root.ownerDocument.defaultView
    const viewportHeight = win?.innerHeight ?? root.ownerDocument.documentElement.clientHeight
    if (viewportHeight > 0) {
      const center = rect.top + rect.height / 2
      const lead = viewportHeight * KEEP_IN_VIEW_LEAD
      const trail = viewportHeight * KEEP_IN_VIEW_TRAIL
      if (rect.bottom > 0 && rect.top < viewportHeight && center >= lead && center <= trail) {
        return
      }
    }
    activeEl.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior })
    return
  }

  activeEl.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior })
}

/** True when the active highlight intersects the current reading page/viewport. */
export function isActiveWordVisibleInViewport(root: HTMLElement, foliate?: FoliateScrollRenderer | null): boolean {
  const activeEl = getActiveHighlightElement(root)
  // No live highlight — not on-screen. Callers that need "still following while
  // highlight is painting" should fall back to word-index range visibility.
  if (!activeEl) return false
  return isRectVisibleInReadingViewport(activeEl.getBoundingClientRect(), root, foliate)
}

/** True when the active word sits in the middle band of the viewport (sticky follow zone). */
export function isActiveWordInStickyViewport(root: HTMLElement, stickyBandRatio = 0.42, foliate?: FoliateScrollRenderer | null): boolean {
  const activeEl = getActiveHighlightElement(root)
  if (!activeEl) return true

  const rect = activeEl.getBoundingClientRect()

  if (foliate && typeof foliate.size === 'number' && foliate.size > 0) {
    const { center, viewportSize, visible } = getActiveWordViewportMetrics(rect, foliate)
    if (!visible) return false

    // Paginated: any on-page word is "following" — bottom-of-page words are still tracked.
    if (foliate.scrolled !== true) return true

    const margin = (viewportSize * (1 - stickyBandRatio)) / 2
    return center >= margin && center <= viewportSize - margin
  }

  const win = root.ownerDocument.defaultView
  if (!win) return true

  const viewportHeight = win.innerHeight
  if (viewportHeight <= 0) return true

  const visible = rect.bottom > 0 && rect.top < viewportHeight
  if (!visible) return false

  const margin = (viewportHeight * (1 - stickyBandRatio)) / 2
  const centerY = rect.top + rect.height / 2
  return centerY >= margin && centerY <= viewportHeight - margin
}

export function collectScrollTargets(doc: Document): Array<Window | HTMLElement> {
  const targets: Array<Window | HTMLElement> = []
  const seen = new Set<EventTarget>()

  const add = (target: Window | HTMLElement | null | undefined) => {
    if (!target || seen.has(target)) return
    seen.add(target)
    targets.push(target)
  }

  add(doc.defaultView ?? undefined)
  add(doc.scrollingElement as HTMLElement | null)

  const candidates = [doc.documentElement, doc.body, ...doc.querySelectorAll('main, [role="doc-main"]')]
  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) continue
    const overflowY = winGetComputedStyle(candidate, doc).overflowY
    const scrollable =
      candidate.scrollHeight > candidate.clientHeight + 2 && (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
    if (scrollable) add(candidate)
  }

  return targets
}

function winGetComputedStyle(element: HTMLElement, doc: Document) {
  return doc.defaultView?.getComputedStyle(element) ?? { overflowY: 'visible' as const }
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
      scroll-margin-block: 18vh;
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
