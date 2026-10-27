import { onScopeDispose } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { closeReaderPanelOnBack, setReaderBackHandler } from '../lib/reader-navigation'

// The router runs the leave guard a few microtasks after the popstate that started it.
const BACK_GESTURE_WINDOW_MS = 1000

/** The back key (Android app) or back gesture (browser) closes the topmost panel instead of leaving the book. */
export function useReaderBackClosesPanel(closeOpenPanel: () => boolean) {
  let poppedAt = 0
  const markPop = () => {
    poppedAt = Date.now()
  }
  const unregister = setReaderBackHandler(closeOpenPanel)
  window.addEventListener('popstate', markPop)

  onBeforeRouteLeave(() => {
    const isBack = Date.now() - poppedAt < BACK_GESTURE_WINDOW_MS
    poppedAt = 0
    // Cancelling a back navigation makes the router restore the history entry.
    if (isBack && closeReaderPanelOnBack()) return false
  })

  onScopeDispose(() => {
    window.removeEventListener('popstate', markPop)
    unregister()
  })
}
