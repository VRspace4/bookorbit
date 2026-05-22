import { describe, expect, it } from 'vitest'
import { getAccessTokenExpiresAtMs, shouldRefreshAccessToken } from '../access-token'

function makeToken(payload: object): string {
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `header.${encodedPayload}.signature`
}

describe('access token helpers', () => {
  it('reads JWT exp as milliseconds', () => {
    expect(getAccessTokenExpiresAtMs(makeToken({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000)
  })

  it('does not refresh a fresh token during short foreground switches', () => {
    const now = 1_700_000_000_000
    const token = makeToken({ exp: now / 1000 + 300 })

    expect(shouldRefreshAccessToken(token, now)).toBe(false)
  })

  it('refreshes when the token is inside the expiry skew', () => {
    const now = 1_700_000_000_000
    const token = makeToken({ exp: now / 1000 + 30 })

    expect(shouldRefreshAccessToken(token, now)).toBe(true)
  })

  it('refreshes when the token cannot be decoded', () => {
    expect(shouldRefreshAccessToken('not-a-jwt')).toBe(true)
  })
})
