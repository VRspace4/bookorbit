import { computed, ref } from 'vue'
import { isStandaloneDisplay } from '../lib/native-app'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_STORAGE_KEY = 'bookorbit:pwa:install-dismissed-until'
const DISMISS_MS = 1000 * 60 * 60 * 24 * 7

const _deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)
const _isInstalled = ref(typeof window !== 'undefined' ? isStandaloneDisplay() : false)
const _dismissedUntil = ref(readDismissedUntil())

function readDismissedUntil(): number {
  if (typeof window === 'undefined') return 0
  try {
    const value = Number(window.localStorage.getItem(DISMISS_STORAGE_KEY))
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function detectIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent.toLowerCase()
  const platform = navigator.platform.toLowerCase()
  return /iphone|ipad|ipod/.test(ua) || (platform === 'macintel' && navigator.maxTouchPoints > 1)
}

function detectSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent.toLowerCase()
  return ua.includes('safari') && !ua.includes('crios') && !ua.includes('fxios') && !ua.includes('edgios')
}

function _onBeforeInstallPrompt(e: Event) {
  e.preventDefault()
  _deferredPrompt.value = e as BeforeInstallPromptEvent
}

function _onAppInstalled() {
  _deferredPrompt.value = null
  _isInstalled.value = true
  _dismissedUntil.value = 0
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', _onBeforeInstallPrompt)
  window.addEventListener('appinstalled', _onAppInstalled)
  const standaloneQuery = window.matchMedia?.('(display-mode: standalone)')
  standaloneQuery?.addEventListener?.('change', () => {
    _isInstalled.value = isStandaloneDisplay()
  })
}

export function useInstallPrompt() {
  const isInstallable = computed(() => _deferredPrompt.value !== null)
  const isInstalled = computed(() => _isInstalled.value)
  const isIosInstallCandidate = computed(() => detectIosDevice() && detectSafari() && !isInstalled.value)
  const isDismissed = computed(() => Date.now() < _dismissedUntil.value)
  const canShowInstallPrompt = computed(() => !isInstalled.value && !isDismissed.value && (isInstallable.value || isIosInstallCandidate.value))
  const installHint = computed(() =>
    isIosInstallCandidate.value ? 'Use Share, then Add to Home Screen.' : 'Open BookOrbit from your dock, desktop, or home screen.',
  )

  async function installApp(): Promise<void> {
    const prompt = _deferredPrompt.value
    if (!prompt) return

    await prompt.prompt()

    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') {
      _deferredPrompt.value = null
    }
  }

  function dismissInstallPrompt(durationMs = DISMISS_MS): void {
    const until = Date.now() + durationMs
    _dismissedUntil.value = until
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, String(until))
    } catch {
      // localStorage can be unavailable in private modes.
    }
  }

  return {
    isInstallable,
    isInstalled,
    isIosInstallCandidate,
    canShowInstallPrompt,
    installHint,
    installApp,
    dismissInstallPrompt,
  }
}

/** Resets module-level singleton state. For use in tests only. */
export function _resetInstallPromptForTest() {
  _deferredPrompt.value = null
  _isInstalled.value = typeof window !== 'undefined' ? isStandaloneDisplay() : false
  _dismissedUntil.value = 0
  try {
    window.localStorage.removeItem(DISMISS_STORAGE_KEY)
  } catch {
    // Ignore storage cleanup in tests without localStorage.
  }
}
