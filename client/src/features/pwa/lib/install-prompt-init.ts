import { ref } from 'vue'
import { isStandaloneDisplay } from './native-app'

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __bookorbitDeferredInstall?: BeforeInstallPromptEvent
  }
}

export const deferredInstallPrompt = ref<BeforeInstallPromptEvent | null>(null)
export const isInstalledDisplay = ref(typeof window !== 'undefined' ? isStandaloneDisplay() : false)

function captureInstallPrompt(event: Event) {
  event.preventDefault()
  const prompt = event as BeforeInstallPromptEvent
  deferredInstallPrompt.value = prompt
  window.__bookorbitDeferredInstall = prompt
}

function onAppInstalled() {
  deferredInstallPrompt.value = null
  delete window.__bookorbitDeferredInstall
  isInstalledDisplay.value = true
}

function syncStandaloneDisplay() {
  isInstalledDisplay.value = isStandaloneDisplay()
}

export function initInstallPromptCapture() {
  if (typeof window === 'undefined' || (window as Window & { __bookorbitInstallPromptInit?: boolean }).__bookorbitInstallPromptInit) {
    return
  }

  ;(window as Window & { __bookorbitInstallPromptInit?: boolean }).__bookorbitInstallPromptInit = true

  if (window.__bookorbitDeferredInstall) {
    deferredInstallPrompt.value = window.__bookorbitDeferredInstall
  }

  window.addEventListener('beforeinstallprompt', captureInstallPrompt)
  window.addEventListener('appinstalled', onAppInstalled)
  window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', syncStandaloneDisplay)
}

initInstallPromptCapture()

export function _resetInstallPromptCaptureForTest() {
  deferredInstallPrompt.value = null
  isInstalledDisplay.value = typeof window !== 'undefined' ? isStandaloneDisplay() : false
  delete window.__bookorbitDeferredInstall
  try {
    window.localStorage.removeItem('bookorbit:pwa:install-dismissed-until')
  } catch {
    // Ignore storage cleanup in tests without localStorage.
  }
}
