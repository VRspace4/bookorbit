import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFoliateInput } from '../useFoliateInput'

interface ViewLike {
  prev: () => void
  next: () => void
  prevSection?: () => void
  nextSection?: () => void
  renderer?: { getAttribute: (name: string) => string | null }
  getBoundingClientRect: () => DOMRect
}

type DocTarget = EventTarget & Document

function makeDocTarget(options: { getSelection?: () => Selection | null } = {}): DocTarget {
  const target = new EventTarget() as DocTarget
  const frameElement = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect,
  } as HTMLIFrameElement

  Object.defineProperty(target, 'defaultView', {
    configurable: true,
    value: {
      frameElement,
      getSelection: options.getSelection ?? (() => null),
    },
  })

  return target
}

function makeTouch(clientX: number, clientY: number, screenX = clientX, screenY = clientY) {
  return { clientX, clientY, screenX, screenY } as Touch
}

function makeTouchEvent(type: string, touches: Touch[], changedTouches = touches) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent
  Object.defineProperty(event, 'touches', { configurable: true, value: touches })
  Object.defineProperty(event, 'changedTouches', { configurable: true, value: changedTouches })
  return event
}

function makeViewHost(view: ViewLike, doc?: DocTarget) {
  const host = document.createElement('div')
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: view.getBoundingClientRect,
  })
  if (doc) {
    view.renderer = {
      getAttribute: view.renderer?.getAttribute ?? (() => null),
      getContents: () => [{ doc: doc as unknown as Document }],
    } as typeof view.renderer
  }
  return host
}

describe('useFoliateInput', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('navigates with document keyboard shortcuts', () => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }

    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', shiftKey: true, bubbles: true }))

    expect(prev).toHaveBeenCalledTimes(2)
    expect(next).toHaveBeenCalledTimes(2)

    input.cleanup()
  })

  it('ignores keyboard navigation while typing in editable inputs', () => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }

    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())

    const textInput = document.createElement('input')
    document.body.appendChild(textInput)

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    textInput.dispatchEvent(event)

    expect(next).not.toHaveBeenCalled()
    expect(prev).not.toHaveBeenCalled()

    textInput.remove()
    input.cleanup()
  })

  it('handles keyboard navigation from iframe document after attachIframeClicks', () => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }

    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())
    const doc = makeDocTarget()

    input.attachIframeClicks(doc)

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }))

    expect(next).toHaveBeenCalledTimes(1)
    expect(prev).toHaveBeenCalledTimes(1)

    input.cleanup()
  })

  it('routes click-zone window messages to prev/next/middle actions', () => {
    vi.useFakeTimers()

    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const onMiddleTap = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }

    const input = useFoliateInput(() => view, onMiddleTap, vi.fn<() => void>(), vi.fn<() => void>())
    const doc = makeDocTarget()
    input.attachIframeClicks(doc)

    const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints')
    const originalOntouchstart = Object.getOwnPropertyDescriptor(window, 'ontouchstart')
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      get: () => 0,
    })
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'ontouchstart')

    doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 5 }, origin: window.location.origin }))
    vi.advanceTimersByTime(300)
    expect(prev).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300)

    doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 95 }, origin: window.location.origin }))
    vi.advanceTimersByTime(300)
    expect(next).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300)

    doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 50 }, origin: window.location.origin }))
    vi.advanceTimersByTime(300)
    expect(onMiddleTap).toHaveBeenCalledTimes(1)

    input.cleanup()

    if (originalMaxTouchPoints) {
      Object.defineProperty(navigator, 'maxTouchPoints', originalMaxTouchPoints)
    }
    if (originalOntouchstart) {
      Object.defineProperty(window, 'ontouchstart', originalOntouchstart)
    }
  })

  it('allows scrolling when a text selection already existed before the touch gesture', () => {
    const selection = { isCollapsed: false, rangeCount: 1 } as Selection
    const handleSelectionEnd = vi.fn<(doc: Document) => void>()
    const doc = makeDocTarget({ getSelection: () => selection })
    const view: ViewLike = {
      prev: vi.fn<() => void>(),
      next: vi.fn<() => void>(),
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }
    const host = makeViewHost(view, doc)
    const input = useFoliateInput(() => view, undefined, handleSelectionEnd, vi.fn<() => void>())

    input.attachViewTouches(host)

    host.dispatchEvent(makeTouchEvent('touchstart', [makeTouch(20, 20)]))
    const move = makeTouchEvent('touchmove', [makeTouch(20, 120)])
    host.dispatchEvent(move)
    const end = makeTouchEvent('touchend', [], [makeTouch(20, 120)])
    host.dispatchEvent(end)

    expect(move.defaultPrevented).toBe(false)
    expect(end.defaultPrevented).toBe(false)
    expect(handleSelectionEnd).not.toHaveBeenCalled()

    input.cleanup()
  })

  it('navigates on horizontal swipe from the reader host (margin areas outside iframe)', () => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }
    const host = makeViewHost(view)
    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())

    input.attachViewTouches(host)

    host.dispatchEvent(makeTouchEvent('touchstart', [makeTouch(10, 50)]))
    host.dispatchEvent(makeTouchEvent('touchend', [], [makeTouch(90, 50)]))

    expect(next).toHaveBeenCalledTimes(1)
    expect(prev).not.toHaveBeenCalled()

    input.cleanup()
  })

  it('navigates sections on horizontal swipe when layout is scrolled', () => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const prevSection = vi.fn<() => void>()
    const nextSection = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      prevSection,
      nextSection,
      renderer: { getAttribute: (name) => (name === 'flow' ? 'scrolled' : null) },
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }
    const doc = makeDocTarget()
    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())

    input.attachIframeClicks(doc)

    doc.dispatchEvent(makeTouchEvent('touchstart', [makeTouch(200, 100)]))
    doc.dispatchEvent(makeTouchEvent('touchend', [], [makeTouch(100, 100)]))

    expect(prevSection).toHaveBeenCalledTimes(1)
    expect(nextSection).not.toHaveBeenCalled()
    expect(prev).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()

    doc.dispatchEvent(makeTouchEvent('touchstart', [makeTouch(100, 100)]))
    doc.dispatchEvent(makeTouchEvent('touchend', [], [makeTouch(200, 100)]))

    expect(nextSection).toHaveBeenCalledTimes(1)

    input.cleanup()
  })

  it('does not treat a vertical scroll as a page turn when iframe-relative clientY stays fixed', () => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }
    const doc = makeDocTarget()
    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())

    input.attachIframeClicks(doc)

    doc.dispatchEvent(makeTouchEvent('touchstart', [makeTouch(20, 200, 20, 200)]))
    doc.dispatchEvent(makeTouchEvent('touchmove', [makeTouch(80, 200, 80, 80)]))
    doc.dispatchEvent(makeTouchEvent('touchend', [], [makeTouch(80, 200, 80, 80)]))

    expect(prev).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()

    input.cleanup()
  })

  it('still suppresses scrolling while a new touch text selection is being made', () => {
    vi.useFakeTimers()

    const selection = { isCollapsed: false, rangeCount: 1 } as Selection
    let activeSelection: Selection | null = null
    const handleSelectionEnd = vi.fn<(doc: Document) => void>()
    const doc = makeDocTarget({ getSelection: () => activeSelection })
    const view: ViewLike = {
      prev: vi.fn<() => void>(),
      next: vi.fn<() => void>(),
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }
    const host = makeViewHost(view, doc)
    const input = useFoliateInput(() => view, undefined, handleSelectionEnd, vi.fn<() => void>())

    input.attachViewTouches(host)

    host.dispatchEvent(makeTouchEvent('touchstart', [makeTouch(20, 20)]))
    activeSelection = selection

    const move = makeTouchEvent('touchmove', [makeTouch(22, 24)])
    host.dispatchEvent(move)
    const end = makeTouchEvent('touchend', [], [makeTouch(22, 24)])
    host.dispatchEvent(end)

    expect(move.defaultPrevented).toBe(true)
    expect(end.defaultPrevented).toBe(true)
    vi.advanceTimersByTime(50)
    expect(handleSelectionEnd).toHaveBeenCalledWith(doc)

    input.cleanup()
  })

  it('stops responding to document keydown after cleanup', () => {
    const next = vi.fn<() => void>()
    const view: ViewLike = {
      prev: vi.fn<() => void>(),
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }

    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())
    input.cleanup()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(next).not.toHaveBeenCalled()
  })
})
