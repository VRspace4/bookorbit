const LEFT_ZONE = 0.3
const RIGHT_ZONE = 0.7
const DOUBLE_CLICK_MS = 300
const SWIPE_THRESHOLD = 50

interface FoliateViewLike {
  prev?: () => void
  next?: () => void
  prevSection?: () => void
  nextSection?: () => void
  renderer?: { getAttribute?: (name: string) => string | null }
  getBoundingClientRect?: () => DOMRect
}

function isScrolledLayout(view: FoliateViewLike): boolean {
  return view.renderer?.getAttribute?.('flow') === 'scrolled'
}

function navigatePrev(view: FoliateViewLike) {
  if (isScrolledLayout(view)) view.prevSection?.()
  else view.prev?.()
}

function navigateNext(view: FoliateViewLike) {
  if (isScrolledLayout(view)) view.nextSection?.()
  else view.next?.()
}

export function useFoliateInput(
  getView: () => unknown,
  onMiddleTap: (() => void) | undefined,
  handleSelectionEnd: (doc: Document) => void,
  handleSelectionChange: (doc: Document) => void,
) {
  const clickedDocs = new WeakSet<Document>()
  let viewTouchTarget: HTMLElement | null = null
  let onViewTouchStart: ((e: TouchEvent) => void) | null = null
  let onViewTouchMove: ((e: TouchEvent) => void) | null = null
  let onViewTouchEnd: ((e: TouchEvent) => void) | null = null

  let lastClickTime = 0
  let lastClickZone: 'left' | 'middle' | 'right' | null = null
  let isNavigating = false
  let touchStartScreenX = 0
  let touchStartScreenY = 0
  let touchStartTime = 0
  let lastTouchTime = 0
  let isTextSelectionInProgress = false
  let selectionActiveAtTouchStart = false
  let longHoldTimeout: ReturnType<typeof setTimeout> | null = null

  function getViewEl() {
    return getView() as FoliateViewLike | null
  }

  function getActiveDoc(): Document | null {
    const view = getView() as {
      renderer?: { getContents?: () => { doc?: Document }[] }
    } | null
    return view?.renderer?.getContents?.()?.[0]?.doc ?? null
  }

  function hasActiveSelection(doc: Document) {
    const selection = doc.defaultView?.getSelection()
    return !!selection && !selection.isCollapsed && selection.rangeCount > 0
  }

  function stableTouchPoint(touch: Touch) {
    return {
      x: Number.isFinite(touch.screenX) ? touch.screenX : touch.clientX,
      y: Number.isFinite(touch.screenY) ? touch.screenY : touch.clientY,
    }
  }

  function postFoliateClick(touch: Touch, doc: Document | null) {
    const viewRect = getViewEl()?.getBoundingClientRect?.()
    if (!viewRect) return
    const iframe = doc?.defaultView?.frameElement as HTMLIFrameElement | null
    if (iframe) {
      const iframeRect = iframe.getBoundingClientRect()
      window.postMessage(
        {
          type: 'foliate-click',
          clientX: iframeRect.left + touch.clientX,
          clientY: iframeRect.top + touch.clientY,
          iframeLeft: iframeRect.left,
          iframeWidth: iframeRect.width,
          eventClientX: touch.clientX,
        },
        window.location.origin,
      )
      return
    }
    window.postMessage(
      {
        type: 'foliate-click',
        clientX: touch.clientX,
        clientY: touch.clientY,
        iframeLeft: viewRect.left,
        iframeWidth: viewRect.width,
        eventClientX: touch.clientX - viewRect.left,
      },
      window.location.origin,
    )
  }

  function handleTouchStart(e: TouchEvent, doc: Document | null) {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]!
    const stablePoint = stableTouchPoint(touch)
    touchStartScreenX = stablePoint.x
    touchStartScreenY = stablePoint.y
    touchStartTime = Date.now()
    isTextSelectionInProgress = false
    selectionActiveAtTouchStart = doc ? hasActiveSelection(doc) : false
    longHoldTimeout = setTimeout(() => {
      longHoldTimeout = null
    }, 500)
  }

  function handleTouchMove(e: TouchEvent, doc: Document | null) {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]!
    const stablePoint = stableTouchPoint(touch)
    const deltaX = Math.abs(stablePoint.x - touchStartScreenX)
    const deltaY = Math.abs(stablePoint.y - touchStartScreenY)
    if (doc && hasActiveSelection(doc) && !selectionActiveAtTouchStart) {
      isTextSelectionInProgress = true
      e.preventDefault()
      return
    }
    if (deltaX > 10 && deltaX > deltaY && !isTextSelectionInProgress) return
  }

  function handleTouchEnd(e: TouchEvent, doc: Document | null) {
    const touchEndTime = Date.now()
    const touchDuration = touchEndTime - touchStartTime
    lastTouchTime = touchEndTime

    try {
      if (doc && hasActiveSelection(doc) && !selectionActiveAtTouchStart) {
        e.preventDefault()
        setTimeout(() => handleSelectionEnd(doc), 50)
        return
      }

      if (!isTextSelectionInProgress && e.changedTouches.length === 1) {
        const touch = e.changedTouches[0]!
        const stablePoint = stableTouchPoint(touch)
        const deltaX = stablePoint.x - touchStartScreenX
        const deltaY = Math.abs(stablePoint.y - touchStartScreenY)

        if (Math.abs(deltaX) >= SWIPE_THRESHOLD && Math.abs(deltaX) > deltaY) {
          if (isNavigating) return
          const view = getViewEl()
          if (!view) return
          isNavigating = true
          e.preventDefault()
          if (deltaX < 0) navigateNext(view)
          else navigatePrev(view)
          setTimeout(() => (isNavigating = false), 300)
          return
        }

        if (touchDuration < 500 && Math.abs(deltaX) < 10 && deltaY < 10) {
          postFoliateClick(touch, doc)
        }
      }
    } finally {
      isTextSelectionInProgress = false
      selectionActiveAtTouchStart = false
    }
  }

  function attachIframeClicks(doc: Document) {
    if (clickedDocs.has(doc)) return
    clickedDocs.add(doc)

    // Keep keyboard navigation active when focus moves into the EPUB iframe.
    doc.addEventListener('keydown', handleKeydown)

    doc.addEventListener(
      'mousedown',
      () => {
        longHoldTimeout = setTimeout(() => {
          longHoldTimeout = null
        }, 500)
      },
      true,
    )

    doc.addEventListener('mouseup', () => {
      handleSelectionEnd(doc)
    })

    doc.addEventListener(
      'click',
      (e: MouseEvent) => {
        if (Date.now() - lastTouchTime < 500) return
        const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null
        if (!iframe) return
        const rect = iframe.getBoundingClientRect()
        const viewportX = rect.left + e.clientX
        const viewportY = rect.top + e.clientY
        window.postMessage(
          {
            type: 'foliate-click',
            clientX: viewportX,
            clientY: viewportY,
            iframeLeft: rect.left,
            iframeWidth: rect.width,
            eventClientX: e.clientX,
          },
          window.location.origin,
        )
      },
      true,
    )

    // Touches inside the EPUB iframe do not bubble to foliate-view; handle them here.
    doc.addEventListener('touchstart', (e: TouchEvent) => handleTouchStart(e, doc), { passive: true })
    doc.addEventListener('touchmove', (e: TouchEvent) => handleTouchMove(e, doc), { passive: false })
    doc.addEventListener('touchend', (e: TouchEvent) => handleTouchEnd(e, doc), { passive: false })

    doc.addEventListener('selectionchange', () => handleSelectionChange(doc))
  }

  function detachViewTouches() {
    if (!viewTouchTarget || !onViewTouchStart || !onViewTouchMove || !onViewTouchEnd) return
    const opts = { capture: true } as const
    viewTouchTarget.removeEventListener('touchstart', onViewTouchStart, opts)
    viewTouchTarget.removeEventListener('touchmove', onViewTouchMove, opts)
    viewTouchTarget.removeEventListener('touchend', onViewTouchEnd, opts)
    viewTouchTarget = null
    onViewTouchStart = null
    onViewTouchMove = null
    onViewTouchEnd = null
  }

  /** Capture-phase listeners on the reader surface (includes margin areas outside the iframe). */
  function attachViewTouches(viewEl: HTMLElement) {
    if (viewTouchTarget === viewEl) return
    detachViewTouches()
    viewTouchTarget = viewEl
    onViewTouchStart = (e) => handleTouchStart(e, getActiveDoc())
    onViewTouchMove = (e) => handleTouchMove(e, getActiveDoc())
    onViewTouchEnd = (e) => handleTouchEnd(e, getActiveDoc())
    const capture = { capture: true } as const
    viewEl.addEventListener('touchstart', onViewTouchStart, { ...capture, passive: true })
    viewEl.addEventListener('touchmove', onViewTouchMove, { ...capture, passive: false })
    viewEl.addEventListener('touchend', onViewTouchEnd, { ...capture, passive: false })
  }

  function handleWindowMessage(e: MessageEvent) {
    if (e.origin !== window.location.origin) return
    if (e.data?.type !== 'foliate-click') return
    const view = getViewEl()
    if (!view) return

    const now = Date.now()
    const timeSinceLastClick = now - lastClickTime

    const viewRect = view.getBoundingClientRect?.()
    if (!viewRect) return

    const x = e.data.clientX - viewRect.left
    const width = viewRect.width

    const leftThreshold = width * LEFT_ZONE
    const rightThreshold = width * RIGHT_ZONE

    let currentZone: 'left' | 'middle' | 'right'
    if (x < leftThreshold) currentZone = 'left'
    else if (x > rightThreshold) currentZone = 'right'
    else currentZone = 'middle'

    if (timeSinceLastClick < DOUBLE_CLICK_MS && lastClickZone === currentZone) {
      lastClickTime = now
      lastClickZone = currentZone
      return
    }

    lastClickTime = now
    lastClickZone = currentZone

    setTimeout(() => {
      if (Date.now() - lastClickTime < DOUBLE_CLICK_MS) return
      if (!longHoldTimeout) return
      if (isNavigating) return

      const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0

      const view = getViewEl()
      if (currentZone === 'left' && !isMobile && view) {
        isNavigating = true
        navigatePrev(view)
        setTimeout(() => (isNavigating = false), 300)
      } else if (currentZone === 'right' && !isMobile && view) {
        isNavigating = true
        navigateNext(view)
        setTimeout(() => (isNavigating = false), 300)
      } else {
        onMiddleTap?.()
      }
    }, DOUBLE_CLICK_MS)
  }

  function handleKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
    const view = getViewEl()
    if (!view) return
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      navigatePrev(view)
      e.preventDefault()
    } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      navigateNext(view)
      e.preventDefault()
    } else if (e.key === ' ' && e.shiftKey) {
      navigatePrev(view)
      e.preventDefault()
    } else if (e.key === ' ') {
      navigateNext(view)
      e.preventDefault()
    }
  }

  window.addEventListener('message', handleWindowMessage)
  document.addEventListener('keydown', handleKeydown)

  function cleanup() {
    detachViewTouches()
    window.removeEventListener('message', handleWindowMessage)
    document.removeEventListener('keydown', handleKeydown)
  }

  return { attachIframeClicks, attachViewTouches, cleanup }
}
