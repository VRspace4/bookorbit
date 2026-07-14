import type { RefreshResponse } from '@bookorbit/types'

const ACCESS_TOKEN_STORAGE_KEY = 'bookorbit:access-token'

let _accessToken: string | null = null
let _onAuthFailure: (() => void) | null = null
let _refreshPromise: Promise<string> | null = null
let _authFailureHandlerEnabled = false

export function setAccessToken(token: string | null): void {
  _accessToken = token
  if (typeof window === 'undefined') return
  try {
    if (token) window.sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token)
    else window.sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY)
  } catch {
    // sessionStorage may be unavailable in private browsing modes.
  }
}

export function getAccessToken(): string | null {
  return _accessToken
}

export function hydrateAccessTokenFromStorage(): string | null {
  if (_accessToken) return _accessToken
  if (typeof window === 'undefined') return null
  try {
    const stored = window.sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)
    if (stored) _accessToken = stored
  } catch {
    // Ignore storage failures during startup.
  }
  return _accessToken
}

export function setOnAuthFailure(fn: () => void): void {
  _onAuthFailure = fn
}

export function enableAuthFailureHandler(): void {
  _authFailureHandlerEnabled = true
}

function notifyAuthFailure(): void {
  if (!_authFailureHandlerEnabled) return
  _onAuthFailure?.()
}

function rawFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (_accessToken) headers.set('Authorization', `Bearer ${_accessToken}`)
  return fetch(input, { ...init, headers, credentials: 'include' })
}

async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks) {
    return navigator.locks.request('bookorbit-auth-refresh', fn)
  }
  return fn()
}

async function attemptRefresh(): Promise<string> {
  return withRefreshLock(async () => {
    const res = await rawFetch('/api/v1/auth/refresh', { method: 'POST' })
    if (!res.ok) throw new Error('refresh failed')
    const data: RefreshResponse = await res.json()
    setAccessToken(data.accessToken)
    return data.accessToken
  })
}

export async function refreshAccessToken(): Promise<string> {
  if (!_refreshPromise) {
    _refreshPromise = attemptRefresh().finally(() => {
      _refreshPromise = null
    })
  }
  return _refreshPromise
}

export async function api(input: RequestInfo | URL, init?: RequestInit & { _isRetry?: boolean }): Promise<Response> {
  const isRetry = init?._isRetry
  const { _isRetry: _, ...rest } = init ?? {}
  const res = await rawFetch(input, rest)

  if (res.status !== 401) return res

  if (isRetry) {
    notifyAuthFailure()
    throw new Error('Session expired')
  }

  try {
    await refreshAccessToken()
  } catch {
    notifyAuthFailure()
    throw new Error('Session expired')
  }

  return api(input, { ...rest, _isRetry: true })
}
