export interface TtsPlaybackSession {
  wasPlaying: boolean
  sectionIndex: number
  wordIndex: number
  savedAt: number
}

const KEY_PREFIX = 'reader:tts-session:'
const STOPPED_KEY_PREFIX = 'reader:tts-stopped:'
const MAX_AGE_MS = 1000 * 60 * 60 * 24

function storageKey(fileId: number) {
  return `${KEY_PREFIX}${fileId}`
}

function sanitizeSession(value: unknown): TtsPlaybackSession | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Partial<TtsPlaybackSession>
  if (typeof raw.wasPlaying !== 'boolean') return null
  if (typeof raw.sectionIndex !== 'number' || !Number.isInteger(raw.sectionIndex) || raw.sectionIndex < 0) return null
  if (typeof raw.wordIndex !== 'number' || !Number.isInteger(raw.wordIndex) || raw.wordIndex < 0) return null
  if (typeof raw.savedAt !== 'number' || !Number.isFinite(raw.savedAt)) return null
  if (Date.now() - raw.savedAt > MAX_AGE_MS) return null
  return {
    wasPlaying: raw.wasPlaying,
    sectionIndex: raw.sectionIndex,
    wordIndex: raw.wordIndex,
    savedAt: raw.savedAt,
  }
}

export function readTtsPlaybackSession(fileId: number): TtsPlaybackSession | null {
  try {
    const raw = window.localStorage.getItem(storageKey(fileId))
    if (!raw) return null
    const sanitized = sanitizeSession(JSON.parse(raw))
    if (!sanitized) {
      window.localStorage.removeItem(storageKey(fileId))
      return null
    }
    return sanitized
  } catch {
    return null
  }
}

export function writeTtsPlaybackSession(fileId: number, session: Pick<TtsPlaybackSession, 'wasPlaying' | 'sectionIndex' | 'wordIndex'>): void {
  try {
    const next: TtsPlaybackSession = { ...session, savedAt: Date.now() }
    window.localStorage.setItem(storageKey(fileId), JSON.stringify(next))
  } catch {
    // Ignore storage failures during playback.
  }
}

export function clearTtsPlaybackSession(fileId: number): void {
  try {
    window.localStorage.removeItem(storageKey(fileId))
  } catch {
    // Ignore storage failures.
  }
}

export function clearAllTtsPlaybackSessions(): void {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(KEY_PREFIX)) window.localStorage.removeItem(key)
    }
  } catch {
    // Ignore storage failures.
  }
}

function stoppedStorageKey(fileId: number) {
  return `${STOPPED_KEY_PREFIX}${fileId}`
}

export function markTtsUserStopped(fileId: number): void {
  try {
    window.sessionStorage.setItem(stoppedStorageKey(fileId), '1')
  } catch {
    // Ignore storage failures.
  }
}

export function clearTtsUserStopped(fileId: number): void {
  try {
    window.sessionStorage.removeItem(stoppedStorageKey(fileId))
  } catch {
    // Ignore storage failures.
  }
}

export function readTtsUserStopped(fileId: number): boolean {
  try {
    return window.sessionStorage.getItem(stoppedStorageKey(fileId)) === '1'
  } catch {
    return false
  }
}
