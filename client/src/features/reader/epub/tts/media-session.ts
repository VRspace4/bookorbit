import { MediaSession } from '@jofr/capacitor-media-session'
import { isCapacitorNative } from '@/features/pwa/lib/native-app'

export type TtsMediaPlaybackStatus = 'idle' | 'loading' | 'speaking' | 'paused' | 'done' | 'error'

export interface TtsMediaSessionController {
  getStatus: () => TtsMediaPlaybackStatus
  getChapterTitle: () => string
  getProgress?: () => number
  pause: () => void
  resume: () => void
  stop: () => void
  replay: () => void
  skipBackward: () => void
  skipForward: () => void
}

let keepaliveAudio: HTMLAudioElement | null = null
let controller: TtsMediaSessionController | null = null
let initialized = false
let actionHandlersRegistered = false
let lastMediaKeyAt = 0
let mediaSessionSuppressed = false
/** Ignore keepalive play/pause events fired by our own start/stop sync (not headset buttons). */
let keepaliveSyncDepth = 0
let lastKeepaliveSyncAt = 0
const KEEPALIVE_EVENT_IGNORE_MS = 750

const MEDIA_KEY_DEBOUNCE_MS = 350
const TTS_MEDIA_SESSION_DURATION_SEC = 3600

function isControllablePlaybackStatus(status: TtsMediaPlaybackStatus | undefined): status is 'speaking' | 'loading' | 'paused' {
  return status === 'speaking' || status === 'loading' || status === 'paused'
}

function resolveAssetUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (typeof window === 'undefined') return path
  return new URL(path, window.location.origin).href
}

function onKeepalivePlaybackEvent(event: Event) {
  if (keepaliveSyncDepth > 0) return
  if (Date.now() - lastKeepaliveSyncAt < KEEPALIVE_EVENT_IGNORE_MS) return
  if (mediaSessionSuppressed) return
  if (!isControllablePlaybackStatus(controller?.getStatus())) return

  const audio = keepaliveAudio
  if (!audio) return

  const status = controller?.getStatus()
  // Only mirror headset events once real speech audio is active — not during startup prefetch.
  if (status === 'loading') return

  const shouldPlayKeepalive = status === 'speaking'

  // Ignore programmatic keepalive sync (e.g. stopKeepalive after the UI pause button).
  const isExternalHeadsetToggle =
    (event.type === 'pause' && shouldPlayKeepalive && audio.paused) || (event.type === 'play' && !shouldPlayKeepalive && !audio.paused)
  if (!isExternalHeadsetToggle) return

  // Some browsers route headset play/pause to the keepalive <audio> element instead of
  // MediaSession action handlers. Mirror that into TTS playback with the same debounce.
  togglePlaybackFromMediaKey()
}

function getKeepaliveAudio(): HTMLAudioElement {
  if (!keepaliveAudio) {
    const audio = new Audio(resolveAssetUrl('/tts-keepalive.wav'))
    audio.loop = true
    audio.volume = 0.05
    audio.preload = 'auto'
    audio.setAttribute('aria-hidden', 'true')
    audio.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:0;left:0;'
    audio.addEventListener('pause', onKeepalivePlaybackEvent)
    audio.addEventListener('play', onKeepalivePlaybackEvent)
    document.body.appendChild(audio)
    keepaliveAudio = audio
  }
  return keepaliveAudio
}

function startKeepalive() {
  // Native Android uses the Capacitor media-session plugin for OS controls.
  // A looping <audio> element would register a second media session in WebView
  // and cause headset play/pause to fire twice (pause then play).
  if (isCapacitorNative()) return

  const audio = getKeepaliveAudio()
  if (!audio.paused) return
  keepaliveSyncDepth++
  lastKeepaliveSyncAt = Date.now()
  void audio
    .play()
    .catch(() => {
      // Autoplay may be blocked until primed by a user gesture.
    })
    .finally(() => {
      keepaliveSyncDepth = Math.max(0, keepaliveSyncDepth - 1)
      lastKeepaliveSyncAt = Date.now()
    })
}

function stopKeepalive() {
  if (!keepaliveAudio || keepaliveAudio.paused) return
  keepaliveSyncDepth++
  lastKeepaliveSyncAt = Date.now()
  try {
    keepaliveAudio.pause()
    keepaliveAudio.currentTime = 0
  } finally {
    keepaliveSyncDepth = Math.max(0, keepaliveSyncDepth - 1)
    lastKeepaliveSyncAt = Date.now()
  }
}

function primeOnFirstGesture() {
  let primed = false

  function onGesture(event: Event) {
    if (primed) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('[aria-label*="TTS"], .tts-toolbar-play, .tts-toolbar-btn, .tts-toolbar-chip, .tts-toolbar-speed')
    ) {
      primed = true
      document.removeEventListener('click', onGesture, true)
      document.removeEventListener('touchstart', onGesture, true)
      return
    }
    primed = true
    document.removeEventListener('click', onGesture, true)
    document.removeEventListener('touchstart', onGesture, true)

    const audio = getKeepaliveAudio()
    keepaliveSyncDepth++
    lastKeepaliveSyncAt = Date.now()
    void audio
      .play()
      .then(() => {
        keepaliveSyncDepth++
        lastKeepaliveSyncAt = Date.now()
        try {
          audio.pause()
        } finally {
          keepaliveSyncDepth = Math.max(0, keepaliveSyncDepth - 1)
          lastKeepaliveSyncAt = Date.now()
        }
      })
      .catch(() => {
        // Ignore — TTS start will retry play().
      })
      .finally(() => {
        keepaliveSyncDepth = Math.max(0, keepaliveSyncDepth - 1)
        lastKeepaliveSyncAt = Date.now()
      })
  }

  document.addEventListener('click', onGesture, true)
  document.addEventListener('touchstart', onGesture, true)
}

function shouldIgnoreMediaKeyAction(): boolean {
  return mediaSessionSuppressed || !isControllablePlaybackStatus(controller?.getStatus())
}

function togglePlaybackFromMediaKey() {
  if (mediaSessionSuppressed) return
  const now = Date.now()
  if (now - lastMediaKeyAt < MEDIA_KEY_DEBOUNCE_MS) return
  lastMediaKeyAt = now

  const st = controller?.getStatus()
  if (!isControllablePlaybackStatus(st)) return
  if (st === 'loading') return
  if (st === 'paused') controller?.resume()
  else controller?.pause()
}

function smartPlay() {
  if (shouldIgnoreMediaKeyAction()) return
  togglePlaybackFromMediaKey()
}

function smartPause() {
  if (shouldIgnoreMediaKeyAction()) return
  togglePlaybackFromMediaKey()
}

function runSkipFromMediaKey(skip: () => void) {
  if (shouldIgnoreMediaKeyAction()) return
  skip()
}

async function registerActionHandlers() {
  if (actionHandlersRegistered) return
  actionHandlersRegistered = true

  const noop = () => {}

  const skipBackwardFromMediaKey = () => {
    runSkipFromMediaKey(() => controller?.skipBackward())
  }

  const skipForwardFromMediaKey = () => {
    runSkipFromMediaKey(() => controller?.skipForward())
  }

  const actions: Array<[MediaSessionAction, () => void]> = [
    ['play', smartPlay],
    ['pause', smartPause],
    [
      'stop',
      () => {
        if (mediaSessionSuppressed) return
        controller?.stop()
      },
    ],
    ['previoustrack', skipBackwardFromMediaKey],
    ['nexttrack', skipForwardFromMediaKey],
    ['seekbackward', skipBackwardFromMediaKey],
    ['seekforward', skipForwardFromMediaKey],
    ['seekto', noop],
  ]

  for (const [action, handler] of actions) {
    try {
      await MediaSession.setActionHandler({ action }, handler)
    } catch (err) {
      if (err instanceof Error && err.name !== 'NotSupportedError') {
        console.warn(`[tts-media-session] setActionHandler(${action}) failed:`, err)
      }
    }
  }
}

function getPositionState() {
  const progress = Math.min(1, Math.max(0, controller?.getProgress?.() ?? 0))
  return {
    duration: TTS_MEDIA_SESSION_DURATION_SEC,
    position: progress * TTS_MEDIA_SESSION_DURATION_SEC,
    playbackRate: 1,
  }
}

async function applyMediaSessionState(status: TtsMediaPlaybackStatus, chapterTitle: string) {
  await registerActionHandlers()

  if (mediaSessionSuppressed) {
    stopKeepalive()
    await MediaSession.setPlaybackState({ playbackState: 'none' })
    await MediaSession.setMetadata({ title: '', artist: '', album: '' })
    return
  }

  switch (status) {
    case 'loading':
      await MediaSession.setMetadata({
        title: 'Read Aloud',
        artist: 'BookOrbit',
        album: chapterTitle || 'Reading',
        artwork: [
          { src: resolveAssetUrl('/pwa-192x192.png'), sizes: '192x192', type: 'image/png' },
          { src: resolveAssetUrl('/pwa-512x512.png'), sizes: '512x512', type: 'image/png' },
        ],
      })
      await MediaSession.setPlaybackState({ playbackState: 'playing' })
      await MediaSession.setPositionState(getPositionState())
      break
    case 'speaking':
      await MediaSession.setMetadata({
        title: 'Read Aloud',
        artist: 'BookOrbit',
        album: chapterTitle || 'Reading',
        artwork: [
          { src: resolveAssetUrl('/pwa-192x192.png'), sizes: '192x192', type: 'image/png' },
          { src: resolveAssetUrl('/pwa-512x512.png'), sizes: '512x512', type: 'image/png' },
        ],
      })
      await MediaSession.setPlaybackState({ playbackState: 'playing' })
      await MediaSession.setPositionState(getPositionState())
      startKeepalive()
      break
    case 'paused':
      await MediaSession.setMetadata({
        title: 'Read Aloud',
        artist: 'BookOrbit',
        album: chapterTitle || 'Reading',
        artwork: [
          { src: resolveAssetUrl('/pwa-192x192.png'), sizes: '192x192', type: 'image/png' },
          { src: resolveAssetUrl('/pwa-512x512.png'), sizes: '512x512', type: 'image/png' },
        ],
      })
      await MediaSession.setPlaybackState({ playbackState: 'paused' })
      await MediaSession.setPositionState(getPositionState())
      stopKeepalive()
      break
    case 'idle':
    case 'done':
    case 'error':
      await MediaSession.setPlaybackState({ playbackState: 'none' })
      await MediaSession.setMetadata({ title: '', artist: '', album: '' })
      stopKeepalive()
      break
  }
}

export function registerTtsMediaSessionController(next: TtsMediaSessionController | null) {
  controller = next
  syncTtsMediaSession()
}

export function syncTtsMediaSession() {
  if (typeof window === 'undefined') return

  const status = controller?.getStatus() ?? 'idle'
  const chapterTitle = controller?.getChapterTitle() ?? 'Reading'

  void applyMediaSessionState(status, chapterTitle).catch((err) => {
    console.warn('[tts-media-session] failed to sync media session:', err)
  })
}

export function suppressTtsMediaSession() {
  mediaSessionSuppressed = true
  stopKeepalive()
  void MediaSession.setPlaybackState({ playbackState: 'none' }).catch(() => {})
  void MediaSession.setMetadata({ title: '', artist: '', album: '' }).catch(() => {})
}

export function unsuppressTtsMediaSession() {
  mediaSessionSuppressed = false
}

export function resetTtsMediaSessionForTests() {
  initialized = false
  actionHandlersRegistered = false
  controller = null
  lastMediaKeyAt = 0
  mediaSessionSuppressed = false
  keepaliveSyncDepth = 0
  lastKeepaliveSyncAt = 0
  stopKeepalive()
  if (keepaliveAudio) {
    keepaliveAudio.remove()
    keepaliveAudio = null
  }
}

export function initTtsMediaSession() {
  if (typeof window === 'undefined') return
  if (initialized) return
  initialized = true

  primeOnFirstGesture()
  void registerActionHandlers().catch((err) => {
    console.warn('[tts-media-session] failed to register action handlers:', err)
  })
}
