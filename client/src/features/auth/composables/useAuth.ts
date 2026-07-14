import { ref } from 'vue'
import type { AuthUser, AuthResponse } from '@bookorbit/types'
import { api, getAccessToken, hydrateAccessTokenFromStorage, refreshAccessToken, setAccessToken, setOnAuthFailure } from '@/lib/api'
import router from '@/router'
import { cancelPendingDisplaySettingsSync, initDisplaySettingsSync, loadDisplaySettingsFromServer } from '@/composables/useDisplaySettingsSync'
import { cancelPendingThemeSync, initThemeSync, loadFromServer } from '@/composables/useThemeSync'
import { cancelPendingLocaleSync, hydrateLocalePreference, initLocaleSync } from '@/composables/useLocaleSync'
import { useSetupStatus } from './useSetupStatus'
import { disconnectAuthorEnrichmentSocket } from '@/features/settings/composables/useAuthorEnrichmentStatus'
import { disconnectBookMetadataFetchSocket } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchStatus'
import { clearBookorbitRuntimeCaches, clearPwaUserState } from '@/features/pwa/lib/native-app'
import { shouldRefreshAccessToken } from '../lib/access-token'
import { resetWhatsNew } from '@/features/whats-new/composables/useWhatsNew'
import { resetLibraries } from '@/features/library/composables/useLibraries'
import { resetSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { resetCollections } from '@/features/collection/composables/useCollections'

const SESSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const FOREGROUND_REFRESH_DEBOUNCE_MS = 30 * 1000

const user = ref<AuthUser | null>(null)
const isLoading = ref(false)
let sessionRefreshTimer: number | null = null
let lastForegroundRefreshAt = 0

function canRefreshSession() {
  return user.value && (typeof document === 'undefined' || document.visibilityState === 'visible')
}

function needsSessionRefresh() {
  return canRefreshSession() && shouldRefreshAccessToken(getAccessToken())
}

function shouldRefreshOnForeground() {
  if (!needsSessionRefresh()) return false
  const now = Date.now()
  if (now - lastForegroundRefreshAt < FOREGROUND_REFRESH_DEBOUNCE_MS) return false
  lastForegroundRefreshAt = now
  return true
}

function stopSessionRefresh() {
  if (sessionRefreshTimer !== null) {
    window.clearInterval(sessionRefreshTimer)
    sessionRefreshTimer = null
  }
}

function startSessionRefresh() {
  stopSessionRefresh()
  sessionRefreshTimer = window.setInterval(() => {
    if (!needsSessionRefresh()) return
    void refreshAccessToken().catch(() => {
      // Let the next foreground API request decide whether the session is gone.
    })
  }, SESSION_REFRESH_INTERVAL_MS)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!shouldRefreshOnForeground()) return
    void refreshAccessToken().catch(() => {
      // Best-effort refresh after a sleeping tab wakes up.
    })
  })
}

function clearAuth() {
  cancelPendingThemeSync()
  cancelPendingDisplaySettingsSync()
  cancelPendingLocaleSync()
  stopSessionRefresh()
  resetLibraries()
  resetSmartScopes()
  resetCollections()
  user.value = null
  setAccessToken(null)
  clearPwaUserState()
  void clearBookorbitRuntimeCaches()
  disconnectAuthorEnrichmentSocket()
  disconnectBookMetadataFetchSocket()
  resetWhatsNew()
}

setOnAuthFailure(() => {
  clearAuth()
  const { needsSetup } = useSetupStatus()
  router.push(needsSetup.value ? '/setup' : '/login')
})

async function me(): Promise<void> {
  const res = await api('/api/v1/auth/me')
  if (!res.ok) throw new Error('Failed to load user')
  user.value = await res.json()
}

async function hydratePreferences(options: { refreshUser?: boolean } = {}): Promise<void> {
  if (options.refreshUser) {
    await me()
  }

  if (user.value?.settings?.syncThemePreferences) {
    await loadFromServer()
    await loadDisplaySettingsFromServer()
  }
  await hydrateLocalePreference()

  initThemeSync()
  initDisplaySettingsSync()
  initLocaleSync()
}

export function useAuth() {
  async function init(): Promise<void> {
    isLoading.value = true
    try {
      hydrateAccessTokenFromStorage()
      if (getAccessToken() && !shouldRefreshAccessToken(getAccessToken())) {
        try {
          await me()
          await hydratePreferences()
          startSessionRefresh()
          return
        } catch {
          // Fall back to refresh if the cached token is no longer valid.
        }
      }

      await refreshAccessToken()
      await me()
      await hydratePreferences()
      startSessionRefresh()
    } catch {
      // no valid session
    } finally {
      initThemeSync()
      initDisplaySettingsSync()
      initLocaleSync()
      isLoading.value = false
    }
  }

  async function login(username: string, password: string): Promise<void> {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message ?? 'Invalid credentials')
    }

    const data: AuthResponse = await res.json()
    setAccessToken(data.accessToken)
    user.value = data.user
    await hydratePreferences({ refreshUser: true })
    startSessionRefresh()

    if (data.user.isDefaultPassword) {
      router.replace('/')
    } else {
      const redirect = router.currentRoute.value.query.redirect as string | undefined
      router.replace(redirect ?? '/')
    }
  }

  async function setup(payload: { username: string; name: string; email: string; password: string; setupToken?: string }): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (payload.setupToken) {
      headers['x-setup-token'] = payload.setupToken
    }

    const res = await fetch('/api/v1/auth/setup', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        username: payload.username,
        name: payload.name,
        email: payload.email,
        password: payload.password,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message ?? 'Failed to complete setup')
    }

    const data: AuthResponse = await res.json()
    setAccessToken(data.accessToken)
    user.value = data.user
    await hydratePreferences()
    startSessionRefresh()

    useSetupStatus().markSetupComplete()
    router.push('/')
  }

  async function logout(): Promise<void> {
    try {
      const res = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' })
      clearAuth()
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data?.logoutUrl) {
          window.location.href = data.logoutUrl
          return
        }
      }
    } catch {
      clearAuth()
    }
    router.push('/login')
  }

  async function loginWithMagicLink(token: string): Promise<void> {
    const res = await fetch('/api/v1/auth/magic-links/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message ?? 'Invalid or expired magic link')
    }

    const data: AuthResponse = await res.json()
    setAccessToken(data.accessToken)
    user.value = data.user
    await hydratePreferences()
    startSessionRefresh()
    router.push('/')
  }

  return { user, isLoading, init, login, loginWithMagicLink, logout, me, setup }
}
