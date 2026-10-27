import { onScopeDispose, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { setReaderBackHandler, setReaderPopHandler } from '../lib/reader-navigation'

const PANEL_ENTRY_KEY = 'readerPanel'
// A history traversal normally lands within a frame; the timeout only guards a browser that drops it.
const RELEASE_TIMEOUT_MS = 500

function isPanelEntry(state: unknown): boolean {
  return Boolean((state as Record<string, unknown> | null)?.[PANEL_ENTRY_KEY])
}

/**
 * Back closes the topmost reader panel: an open panel owns a history entry on the reader's URL, and
 * Back pops it. Those pops are kept from the router (see installReaderPanelPopFilter), which reads a pop
 * between two entries of the same book as a duplicate reader entry and exits the book.
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

  /** True for the pops this reader's panels own, which the router must not see. */
  function claimPop(event: PopStateEvent): boolean {
    if (finishRelease) {
      finishRelease()
    } else if (isPanelEntry(event.state)) {
      // Forward landed back on a panel entry whose panel is gone.
      stepOffPanelEntry()
    } else if (entryPushed) {
      entryPushed = false
      closeOpenPanel()
      if (isPanelOpen()) pushEntry()
    } else {
      return false
    }
    return true
  }

  // A reload while a panel was open leaves the reader sitting on that panel's entry.
  const startsOnPanelEntry = isPanelEntry(window.history.state)

  // Watch first: if reading the panels throws during setup, nothing global is left registered.
  watch(
    isPanelOpen,
    (open) => {
      if (open && !entryPushed && !finishRelease) pushEntry()
      else if (!open && entryPushed) void releaseEntry()
    },
    { immediate: true },
  )

  const unregisterPops = setReaderPopHandler(claimPop)
  const unregisterBackButton = setReaderBackHandler(closeOpenPanel)
  if (startsOnPanelEntry) stepOffPanelEntry()

  onBeforeRouteLeave(() => releaseEntry())

  onScopeDispose(() => {
    unregisterPops()
    unregisterBackButton()
  })
}
