import { computed, ref } from 'vue'

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>

const needRefresh = ref(false)
const offlineReady = ref(false)
const restartReady = ref(false)
const registrationError = ref<string | null>(null)

let registered = false
let updateServiceWorker: UpdateServiceWorker | null = null

function shouldRegisterServiceWorker() {
  return import.meta.env.PROD || import.meta.env.VITE_PWA_DEV === 'true' || Boolean(import.meta.env.VITE_HMR_HOST)
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
          needRefresh.value = true
        },
        onOfflineReady() {
          offlineReady.value = true
        },
        onNeedReload() {
          restartReady.value = true
        },
      })
    } catch (error) {
      registrationError.value = error instanceof Error ? error.message : 'Service worker registration failed'
    }
  }

  async function activateUpdate() {
    if (!updateServiceWorker) return
    await updateServiceWorker(false)
    needRefresh.value = false
    restartReady.value = true
  }

  function restartNow() {
    window.location.reload()
  }

  function dismissOfflineReady() {
    offlineReady.value = false
  }

  function dismissUpdate() {
    needRefresh.value = false
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
}
