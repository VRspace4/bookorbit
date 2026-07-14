import { computed, ref } from 'vue'

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>

const UPDATE_DISMISS_STORAGE_KEY = 'bookorbit:pwa:update-dismissed'

const needRefresh = ref(false)
const offlineReady = ref(false)
const restartReady = ref(false)
const registrationError = ref<string | null>(null)

let registered = false
let updateServiceWorker: UpdateServiceWorker | null = null

function shouldRegisterServiceWorker() {
  return import.meta.env.PROD || import.meta.env.VITE_PWA_DEV === 'true' || Boolean(import.meta.env.VITE_HMR_HOST)
}

/**
 * Vite dev service workers rebuild often and commonly leave a worker in `waiting`.
 * Surfacing that as "Update available" on every remote-dev reload interrupts reading
 * and is noise. Production keeps the prompt.
 *
 * Override with VITE_PWA_UPDATE_PROMPTS=true|false when you need to force either behavior.
 */
function shouldSurfaceUpdatePrompts() {
  const override = import.meta.env.VITE_PWA_UPDATE_PROMPTS
  if (override === 'true') return true
  if (override === 'false') return false
  return import.meta.env.PROD
}

function readUpdateDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(UPDATE_DISMISS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeUpdateDismissed(dismissed: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (dismissed) {
      window.sessionStorage.setItem(UPDATE_DISMISS_STORAGE_KEY, '1')
    } else {
      window.sessionStorage.removeItem(UPDATE_DISMISS_STORAGE_KEY)
    }
  } catch {
    // sessionStorage can be unavailable in private modes.
  }
}

function markNeedRefresh(): void {
  if (!shouldSurfaceUpdatePrompts()) return
  if (readUpdateDismissed()) return
  needRefresh.value = true
}

function markRestartReady(): void {
  if (!shouldSurfaceUpdatePrompts()) return
  restartReady.value = true
}

export function usePwaServiceWorker() {
  async function register() {
    if (registered || !shouldRegisterServiceWorker() || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    registered = true

    try {
      const { registerSW } = await import('virtual:pwa-register')
      updateServiceWorker = registerSW({
        immediate: true,
        onNeedRefresh() {
          markNeedRefresh()
        },
        onOfflineReady() {
          offlineReady.value = true
        },
        onNeedReload() {
          markRestartReady()
        },
      })
    } catch (error) {
      registrationError.value = error instanceof Error ? error.message : 'Service worker registration failed'
    }
  }

  async function activateUpdate() {
    if (!updateServiceWorker) return
    writeUpdateDismissed(false)
    await updateServiceWorker(false)
    needRefresh.value = false
    restartReady.value = true
  }

  function restartNow() {
    writeUpdateDismissed(false)
    window.location.reload()
  }

  function dismissOfflineReady() {
    offlineReady.value = false
  }

  function dismissUpdate() {
    needRefresh.value = false
    writeUpdateDismissed(true)
  }

  return {
    needRefresh: computed(() => needRefresh.value),
    offlineReady: computed(() => offlineReady.value),
    restartReady: computed(() => restartReady.value),
    registrationError: computed(() => registrationError.value),
    register,
    activateUpdate,
    restartNow,
    dismissOfflineReady,
    dismissUpdate,
  }
}

export function _resetPwaServiceWorkerForTest() {
  needRefresh.value = false
  offlineReady.value = false
  restartReady.value = false
  registrationError.value = null
  registered = false
  updateServiceWorker = null
  writeUpdateDismissed(false)
}
