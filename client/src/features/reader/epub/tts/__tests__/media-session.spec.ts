import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mediaSessionMock = vi.hoisted(() => ({
  setMetadata: vi.fn(async () => undefined),
  setPlaybackState: vi.fn(async () => undefined),
  setActionHandler: vi.fn(async () => undefined),
  setPositionState: vi.fn(async () => undefined),
}))

vi.mock('@jofr/capacitor-media-session', () => ({
  MediaSession: mediaSessionMock,
}))

import {
  initTtsMediaSession,
  registerTtsMediaSessionController,
  resetTtsMediaSessionForTests,
  suppressTtsMediaSession,
  syncTtsMediaSession,
} from '../media-session'

describe('tts media session', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
    resetTtsMediaSessionForTests()
    registerTtsMediaSessionController(null)
    vi.stubGlobal('Audio', function (this: HTMLAudioElement, src?: string) {
      const audio = document.createElement('audio')
      if (src) audio.src = src
      audio.play = vi.fn(async () => undefined) as typeof audio.play
      audio.pause = vi.fn() as typeof audio.pause
      Object.defineProperty(audio, 'paused', { configurable: true, value: true })
      return audio
    } as unknown as typeof Audio)
  })

  afterEach(() => {
    resetTtsMediaSessionForTests()
    registerTtsMediaSessionController(null)
  })

  it('registers play and pause handlers that toggle playback', async () => {
    initTtsMediaSession()
    await Promise.resolve()

    let status: 'idle' | 'speaking' | 'paused' = 'speaking'
    registerTtsMediaSessionController({
      getStatus: () => status,
      getChapterTitle: () => 'Chapter 1',
      pause: () => {
        status = 'paused'
      },
      resume: () => {
        status = 'speaking'
      },
      stop: () => {
        status = 'idle'
      },
      replay: () => {
        status = 'speaking'
      },
      skipBackward: vi.fn(),
      skipForward: vi.fn(),
    })

    const handlers = new Map<string, () => void>()
    for (const call of mediaSessionMock.setActionHandler.mock.calls) {
      const [options, handler] = call as unknown as [{ action: string }, () => void]
      handlers.set(options.action, handler)
    }

    handlers.get('pause')?.()
    expect(status).toBe('paused')

    handlers.get('play')?.()
    expect(status).toBe('speaking')
  })

  it('debounces duplicate play/pause events on Capacitor native', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Capacitor', {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    })

    initTtsMediaSession()
    await Promise.resolve()

    let status: 'idle' | 'speaking' | 'paused' = 'speaking'
    registerTtsMediaSessionController({
      getStatus: () => status,
      getChapterTitle: () => 'Chapter 1',
      pause: () => {
        status = 'paused'
      },
      resume: () => {
        status = 'speaking'
      },
      stop: () => {
        status = 'idle'
      },
      replay: () => {
        status = 'speaking'
      },
      skipBackward: vi.fn(),
      skipForward: vi.fn(),
    })

    const handlers = new Map<string, () => void>()
    for (const call of mediaSessionMock.setActionHandler.mock.calls) {
      const [options, handler] = call as unknown as [{ action: string }, () => void]
      handlers.set(options.action, handler)
    }

    // Android headsets often dispatch both pause and play for one button press.
    handlers.get('pause')?.()
    handlers.get('play')?.()
    expect(status).toBe('paused')

    vi.advanceTimersByTime(400)
    handlers.get('play')?.()
    handlers.get('pause')?.()
    expect(status).toBe('speaking')

    vi.useRealTimers()
  })

  it('ignores play, pause, and skip media keys when playback is idle', async () => {
    initTtsMediaSession()
    await Promise.resolve()

    const pause = vi.fn()
    const resume = vi.fn()
    const skipBackward = vi.fn()

    registerTtsMediaSessionController({
      getStatus: () => 'idle',
      getChapterTitle: () => 'Chapter 1',
      pause,
      resume,
      stop: vi.fn(),
      replay: vi.fn(),
      skipBackward,
      skipForward: vi.fn(),
    })

    const handlers = new Map<string, () => void>()
    for (const call of mediaSessionMock.setActionHandler.mock.calls) {
      const [options, handler] = call as unknown as [{ action: string }, () => void]
      handlers.set(options.action, handler)
    }

    handlers.get('play')?.()
    handlers.get('pause')?.()
    handlers.get('previoustrack')?.()

    expect(pause).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
    expect(skipBackward).not.toHaveBeenCalled()
  })

  it('ignores media keys while the session is suppressed after stop', async () => {
    initTtsMediaSession()
    await Promise.resolve()

    const pause = vi.fn()
    const resume = vi.fn()
    const skipBackward = vi.fn()

    registerTtsMediaSessionController({
      getStatus: () => 'paused',
      getChapterTitle: () => 'Chapter 1',
      pause,
      resume,
      stop: vi.fn(),
      replay: vi.fn(),
      skipBackward,
      skipForward: vi.fn(),
    })

    suppressTtsMediaSession()

    const handlers = new Map<string, () => void>()
    for (const call of mediaSessionMock.setActionHandler.mock.calls) {
      const [options, handler] = call as unknown as [{ action: string }, () => void]
      handlers.set(options.action, handler)
    }

    handlers.get('play')?.()
    handlers.get('pause')?.()
    handlers.get('previoustrack')?.()

    expect(pause).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
    expect(skipBackward).not.toHaveBeenCalled()
  })

  it('registers track-skip handlers that move playback by sentence', async () => {
    initTtsMediaSession()
    await Promise.resolve()

    const skipBackward = vi.fn()
    const skipForward = vi.fn()

    registerTtsMediaSessionController({
      getStatus: () => 'speaking',
      getChapterTitle: () => 'Chapter 1',
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      replay: vi.fn(),
      skipBackward,
      skipForward,
    })

    const handlers = new Map<string, () => void>()
    for (const call of mediaSessionMock.setActionHandler.mock.calls) {
      const [options, handler] = call as unknown as [{ action: string }, () => void]
      handlers.set(options.action, handler)
    }

    handlers.get('previoustrack')?.()
    handlers.get('nexttrack')?.()
    handlers.get('seekbackward')?.()
    handlers.get('seekforward')?.()

    expect(skipBackward).toHaveBeenCalledTimes(2)
    expect(skipForward).toHaveBeenCalledTimes(2)
  })

  it('registers seek handlers that skip playback by sentence', async () => {
    initTtsMediaSession()
    await Promise.resolve()

    const skipBackward = vi.fn()
    const skipForward = vi.fn()

    registerTtsMediaSessionController({
      getStatus: () => 'speaking',
      getChapterTitle: () => 'Chapter 1',
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      replay: vi.fn(),
      skipBackward,
      skipForward,
    })

    const handlers = new Map<string, () => void>()
    for (const call of mediaSessionMock.setActionHandler.mock.calls) {
      const [options, handler] = call as unknown as [{ action: string }, () => void]
      handlers.set(options.action, handler)
    }

    handlers.get('seekbackward')?.()
    handlers.get('seekforward')?.()

    expect(skipBackward).toHaveBeenCalledTimes(1)
    expect(skipForward).toHaveBeenCalledTimes(1)
  })

  it('ignores seek media keys when playback is idle', async () => {
    initTtsMediaSession()
    await Promise.resolve()

    const skipBackward = vi.fn()
    const skipForward = vi.fn()

    registerTtsMediaSessionController({
      getStatus: () => 'idle',
      getChapterTitle: () => 'Chapter 1',
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      replay: vi.fn(),
      skipBackward,
      skipForward,
    })

    const handlers = new Map<string, () => void>()
    for (const call of mediaSessionMock.setActionHandler.mock.calls) {
      const [options, handler] = call as unknown as [{ action: string }, () => void]
      handlers.set(options.action, handler)
    }

    handlers.get('seekbackward')?.()
    handlers.get('seekforward')?.()

    expect(skipBackward).not.toHaveBeenCalled()
    expect(skipForward).not.toHaveBeenCalled()
  })

  it('starts native media session playback while speaking', async () => {
    initTtsMediaSession()
    registerTtsMediaSessionController({
      getStatus: () => 'speaking',
      getChapterTitle: () => 'Chapter 2',
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      replay: vi.fn(),
      skipBackward: vi.fn(),
      skipForward: vi.fn(),
    })
    syncTtsMediaSession()
    await Promise.resolve()
    await Promise.resolve()

    expect(mediaSessionMock.setPlaybackState).toHaveBeenCalledWith({ playbackState: 'playing' })
    expect(mediaSessionMock.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Read Aloud',
        album: 'Chapter 2',
      }),
    )
  })
})
