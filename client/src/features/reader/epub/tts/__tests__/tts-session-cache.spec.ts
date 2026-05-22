import { afterEach, describe, expect, it } from 'vitest'
import {
  clearAllTtsPlaybackSessions,
  clearTtsPlaybackSession,
  clearTtsUserStopped,
  markTtsUserStopped,
  readTtsPlaybackSession,
  readTtsUserStopped,
  writeTtsPlaybackSession,
} from '../tts-session-cache'

describe('tts-session-cache', () => {
  afterEach(() => {
    clearAllTtsPlaybackSessions()
    clearTtsUserStopped(42)
    clearTtsUserStopped(7)
  })

  it('writes and reads a playback session', () => {
    writeTtsPlaybackSession(42, { enabled: true, wasPlaying: true, sectionIndex: 3, wordIndex: 12 })
    expect(readTtsPlaybackSession(42)).toEqual(
      expect.objectContaining({
        enabled: true,
        wasPlaying: true,
        sectionIndex: 3,
        wordIndex: 12,
      }),
    )
  })

  it('clears a stored session', () => {
    writeTtsPlaybackSession(42, { enabled: true, wasPlaying: true, sectionIndex: 0, wordIndex: 0 })
    clearTtsPlaybackSession(42)
    expect(readTtsPlaybackSession(42)).toBeNull()
  })

  it('drops stale sessions', () => {
    window.localStorage.setItem(
      'reader:tts-session:7',
      JSON.stringify({
        wasPlaying: true,
        sectionIndex: 1,
        wordIndex: 2,
        savedAt: Date.now() - 1000 * 60 * 60 * 25,
      }),
    )
    expect(readTtsPlaybackSession(7)).toBeNull()
  })

  it('defaults enabled from wasPlaying for legacy sessions', () => {
    window.localStorage.setItem(
      'reader:tts-session:7',
      JSON.stringify({
        wasPlaying: true,
        sectionIndex: 1,
        wordIndex: 2,
        savedAt: Date.now(),
      }),
    )
    expect(readTtsPlaybackSession(7)).toEqual(
      expect.objectContaining({
        enabled: true,
        wasPlaying: true,
      }),
    )
  })

  it('reads an enabled-but-paused session', () => {
    writeTtsPlaybackSession(42, { enabled: true, wasPlaying: false, sectionIndex: 2, wordIndex: 8 })
    expect(readTtsPlaybackSession(42)).toEqual(
      expect.objectContaining({
        enabled: true,
        wasPlaying: false,
        sectionIndex: 2,
        wordIndex: 8,
      }),
    )
  })

  it('persists and clears the user-stopped flag in localStorage', () => {
    expect(readTtsUserStopped(42)).toBe(false)
    markTtsUserStopped(42)
    expect(readTtsUserStopped(42)).toBe(true)
    clearTtsUserStopped(42)
    expect(readTtsUserStopped(42)).toBe(false)
  })
})
