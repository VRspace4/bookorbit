const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000

function decodeBase64Url(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    return atob(base64 + padding)
  } catch {
    return null
  }
}

export function getAccessTokenExpiresAtMs(token: string | null): number | null {
  if (!token) return null
  const payload = token.split('.')[1]
  if (!payload) return null

  const decoded = decodeBase64Url(payload)
  if (!decoded) return null

  try {
    const parsed = JSON.parse(decoded) as { exp?: unknown }
    return typeof parsed.exp === 'number' && Number.isFinite(parsed.exp) ? parsed.exp * 1000 : null
  } catch {
    return null
  }
}

export function shouldRefreshAccessToken(token: string | null, nowMs = Date.now(), skewMs = ACCESS_TOKEN_REFRESH_SKEW_MS): boolean {
  const expiresAtMs = getAccessTokenExpiresAtMs(token)
  if (expiresAtMs === null) return true
  return expiresAtMs - nowMs <= skewMs
}
