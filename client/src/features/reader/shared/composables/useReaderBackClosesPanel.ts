import { onScopeDispose, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { setReaderBackHandler } from '../lib/reader-navigation'

const PANEL_ENTRY_KEY = 'readerPanel'
// A history traversal normally lands within a frame; the timeout only guards a browser that drops it.
const RELEASE_TIMEOUT_MS = 500

function isPanelEntry(state: unknown): boolean {
  return Boolean((state as Record<string, unknown> | null)?.[PANEL_ENTRY_KEY])
}

/**
 * Back closes the topmost reader panel: an open panel owns a history entry on the reader's URL, and
 * Back pops it. Those pops are kept from the router, which reads a pop between two entries of the same
 * book as a duplicate reader entry and exits the book.
 */
export function useReaderBackClosesPanel(isPanelOpen: () => boolean, closeOpenPanel: () => boolean) {
  let entryPushed = false
  let finishRelease: (() => void) | null = null

  function pushEntry() {
    window.history.pushState({ ...window.history.state, [PANEL_ENTRY_KEY]: true }, '')
    entryPushed = true
  }

  function releaseEntry(): Promise<void> {
    const ownsCurrentEntry = entryPushed && isPanelEntry(window.history.state)
    entryPushed = false
    if (!ownsCurrentEntry) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => finishRelease?.(), RELEASE_TIMEOUT_MS)
      finishRelease = () => {
        clearTimeout(timer)
        finishRelease = null
        resolve()
      }
      window.history.back()
    })
  }

  function stepOffPanelEntry() {
    entryPushed = true
    void releaseEntry()
  }

  // Capture runs before the router's own popstate listener on window.
  function handlePopState(event: PopStateEvent) {
    if (finishRelease) {
      event.stopImmediatePropagation()
      finishRelease()
    } else if (isPanelEntry(event.state)) {
      // Forward landed back on a panel entry whose panel is gone.
      event.stopImmediatePropagation()
      stepOffPanelEntry()
    } else if (entryPushed) {
      event.stopImmediatePropagation()
      entryPushed = false
      closeOpenPanel()
      if (isPanelOpen()) pushEntry()
    }
  }

  window.addEventListener('popstate', handlePopState, { capture: true })
  const unregisterBackButton = setReaderBackHandler(closeOpenPanel)

  // A reload while a panel was open leaves the reader sitting on that panel's entry.
  if (isPanelEntry(window.history.state)) stepOffPanelEntry()

  watch(
    isPanelOpen,
    (open) => {
      if (open && !entryPushed && !finishRelease) pushEntry()
      else if (!open && entryPushed) void releaseEntry()
    },
    { immediate: true },
  )

  onBeforeRouteLeave(() => releaseEntry())

  onScopeDispose(() => {
    window.removeEventListener('popstate', handlePopState, { capture: true })
    unregisterBackButton()
  })
}
