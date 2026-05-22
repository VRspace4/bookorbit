import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import type { EpubReaderSettings, TtsProvider } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useTtsCredentials } from '../tts/credentials'
import { AZURE_DEFAULT_VOICE, GCP_CHIRP3_DEFAULT_VOICE, GPT_4O_MINI_TTS_DEFAULT_VOICE, KOKORO_DEFAULT_VOICE, XAI_DEFAULT_VOICE } from '../tts/voices'
import { registerTtsMediaSessionController, suppressTtsMediaSession, syncTtsMediaSession, unsuppressTtsMediaSession } from '../tts/media-session'
import { buildPreparedAudioCacheKey, getOrCreatePreparedAudio } from '../tts/tts-audio-cache'
import { createTtsOutputChain } from '../tts/tts-audio-output'
import {
  clearTtsPlaybackSession,
  clearTtsUserStopped,
  markTtsUserStopped,
  readTtsPlaybackSession,
  readTtsUserStopped,
  writeTtsPlaybackSession,
  type TtsPlaybackSession,
} from '../tts/tts-session-cache'
import { useTtsUsage } from '../tts/tts-usage'
import { resolveCloudTtsProvider } from '../tts/tts-provider-display'
import {
  buildWordIndex,
  clearTtsHighlight,
  findSentenceForWord,
  findWordIndexAtPoint,
  collectScrollTargets,
  highlightWord,
  injectTtsHighlightStyles,
  isActiveWordInStickyViewport,
  scrollActiveWordIntoView,
  type FoliateScrollRenderer,
  splitIntoSentences,
  type SentenceInfo,
  type WordEntry,
} from '../tts/word-index'

export type TtsStatus = 'idle' | 'loading' | 'speaking' | 'paused' | 'done' | 'error'

export interface TtsStartOptions {
  userInitiated?: boolean
}

export interface TtsPersistedPosition {
  sectionIndex: number
  wordIndex: number
}

interface UseEpubTtsOptions {
  fileId: number
  getDocument: () => Document | null
  getSettings: () => EpubReaderSettings
  bookLanguage: Ref<string>
  getChapterTitle?: () => string
  getResumeKey?: () => string | null
  getCurrentSectionIndex?: () => number
  getPersistedTtsPosition?: () => TtsPersistedPosition | null
  onTtsWordIndexChange?: (wordIndex: number) => void
  onTtsCheckpoint?: () => void
  onSectionComplete?: () => void
  getFoliateRenderer?: () => FoliateScrollRenderer | null
}

interface SpeechRuntime {
  abort: AbortController
  audioContext: AudioContext | null
  source: AudioBufferSourceNode | null
  rafId: number | null
  stopped: boolean
}

type CloudAudioFetcher = (sentence: SentenceInfo, signal: AbortSignal) => Promise<ArrayBuffer>
type PreparedAudioBuilder = (sentence: SentenceInfo, activeRuntime: SpeechRuntime, ctx: AudioContext) => Promise<PreparedAudio>
type AzureSpeechSdk = typeof import('microsoft-cognitiveservices-speech-sdk')

interface PreparedAudio {
  sentence: SentenceInfo
  buffer: AudioBuffer
  boundaries?: Array<{ offset: number; audioOffsetSec: number }>
  charStarts?: number[]
}

interface PlayAudioBufferOptions {
  closeContextOnEnd?: boolean
}

const CLOUD_SILENCE_THRESHOLD = 0.0025
const CLOUD_SILENCE_PADDING_SECONDS = 0.06
const AUDIO_PREFETCH_SENTENCE_COUNT = 4

let azureSdkPromise: Promise<AzureSpeechSdk> | null = null
let warmUpPromise: Promise<void> | null = null

function getAzureSdk(): Promise<AzureSpeechSdk> {
  azureSdkPromise ??= import('microsoft-cognitiveservices-speech-sdk')
  return azureSdkPromise
}

const DEFAULT_RUNTIME = (): SpeechRuntime => ({
  abort: new AbortController(),
  audioContext: null,
  source: null,
  rafId: null,
  stopped: false,
})

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function localWordEndChars(sentence: SentenceInfo, words: WordEntry[]): number[] {
  const out: number[] = []
  let cursor = 0
  for (let i = sentence.wordStartIdx; i < sentence.wordEndIdxExclusive; i++) {
    cursor += words[i]?.word.length ?? 0
    if (i < sentence.wordEndIdxExclusive - 1) cursor += 1
    out.push(cursor)
  }
  return out
}

function wordIndexForFraction(ends: number[], fraction: number): number {
  const total = ends[ends.length - 1] ?? 1
  const target = total * fraction
  let lo = 0
  let hi = ends.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((ends[mid] ?? 0) > target) hi = mid
    else lo = mid + 1
  }
  return Math.min(lo, ends.length - 1)
}

function trimAudioBufferSilence(ctx: AudioContext, buffer: AudioBuffer): AudioBuffer {
  if (buffer.length <= 0 || buffer.numberOfChannels <= 0) return buffer

  let firstSoundFrame = -1
  let lastSoundFrame = -1

  for (let frame = 0; frame < buffer.length; frame++) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      if (Math.abs(buffer.getChannelData(channel)[frame] ?? 0) > CLOUD_SILENCE_THRESHOLD) {
        firstSoundFrame = frame
        break
      }
    }
    if (firstSoundFrame >= 0) break
  }

  if (firstSoundFrame < 0) return buffer

  for (let frame = buffer.length - 1; frame >= firstSoundFrame; frame--) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      if (Math.abs(buffer.getChannelData(channel)[frame] ?? 0) > CLOUD_SILENCE_THRESHOLD) {
        lastSoundFrame = frame
        break
      }
    }
    if (lastSoundFrame >= 0) break
  }

  const paddingFrames = Math.round(buffer.sampleRate * CLOUD_SILENCE_PADDING_SECONDS)
  const startFrame = Math.max(0, firstSoundFrame - paddingFrames)
  const endFrame = Math.min(buffer.length, lastSoundFrame + paddingFrames + 1)
  if (startFrame === 0 && endFrame === buffer.length) return buffer

  const trimmed = ctx.createBuffer(buffer.numberOfChannels, endFrame - startFrame, buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    trimmed.copyToChannel(buffer.getChannelData(channel).subarray(startFrame, endFrame), channel)
  }
  return trimmed
}

export function useEpubTts(options: UseEpubTtsOptions) {
  const { credentials, ensureLoaded } = useTtsCredentials()
  const { reportUsage } = useTtsUsage()
  const status = ref<TtsStatus>('idle')
  const error = ref<string | null>(null)
  const activeIndex = ref(-1)
  const wordCount = ref(0)
  const currentSentenceText = ref('')
  const scrollFollowEnabled = ref(true)

  let root: HTMLElement | null = null
  let words: WordEntry[] = []
  let sentences: SentenceInfo[] = []
  let runtime: SpeechRuntime | null = null
  let missingConfigWarned = false
  let savedWordIndex: number | null = null
  let savedResumeKey: string | null = null
  let lastPersistedSentenceStart: number | null = null
  let loadedDocumentSectionIndex: number | null = null
  let autoResumeAttempted = false
  let userStoppedPlayback = readTtsUserStopped(options.fileId)
  let playbackGeneration = 0
  let playbackStartDepth = 0
  let highlightRestoreTimer: ReturnType<typeof setTimeout> | null = null
  let highlightRestoreFrame = 0
  let programmaticScrollUntil = 0
  let scrollFollowEvalTimer: ReturnType<typeof setTimeout> | null = null
  const scrollListenerCleanupByDoc = new WeakMap<Document, () => void>()
  let foliateShellScrollCleanup: (() => void) | null = null
  let touchScrollStartY: number | null = null
  const tappedDocs = new WeakSet<Document>()
  const initialSession = readTtsPlaybackSession(options.fileId)
  const ttsEnabled = ref(Boolean(initialSession?.enabled && !userStoppedPlayback))

  const isActive = computed(() => ttsEnabled.value)
  const isPlaying = computed(() => status.value === 'speaking' || status.value === 'loading')
  const progress = computed(() => {
    if (wordCount.value <= 0 || activeIndex.value < 0) return 0
    return Math.min(1, (activeIndex.value + 1) / wordCount.value)
  })

  function settings() {
    return options.getSettings()
  }

  const currentProvider = ref<TtsProvider | null>(ttsEnabled.value ? resolveCloudTtsProvider(null, settings().ttsProvider) : null)

  function activeRoot(): HTMLElement | null {
    const doc = options.getDocument()
    if (!doc?.body) return null
    root = doc.body
    injectTtsHighlightStyles(doc, settings().ttsSentenceHighlightColor, settings().ttsWordHighlightColor)
    return root
  }

  function rebuildIndex(force = false) {
    const currentRoot = activeRoot()
    if (!currentRoot) {
      words = []
      sentences = []
      wordCount.value = 0
      return false
    }
    const sectionIndex = currentSectionIndex()
    if (!force && words.length > 0 && sectionIndex !== undefined && sectionIndex === loadedDocumentSectionIndex) {
      return true
    }
    words = buildWordIndex(currentRoot)
    sentences = splitIntoSentences(words, 0)
    wordCount.value = words.length
    lastPersistedSentenceStart = null
    return words.length > 0
  }

  function preparedAudioCacheKey(sentence: SentenceInfo, provider: TtsProvider): string {
    return buildPreparedAudioCacheKey(provider, settings(), sentence, options.bookLanguage.value || 'en')
  }

  async function warmUp() {
    if (warmUpPromise) return warmUpPromise

    warmUpPromise = (async () => {
      await ensureLoaded()
      const provider = resolveProvider(settings().ttsProvider)
      if (provider === 'azure' && credentials.azureKey) {
        await getAzureSdk()
      }
    })()

    return warmUpPromise
  }

  function isCloudPrefetchProvider(provider: TtsProvider): boolean {
    return provider === 'xai' || provider === 'gcp-chirp3' || provider === 'kokoro' || provider === 'gpt-4o-mini-tts'
  }

  function resolvePrefetchWordIndex(fromWordIndex?: number): number | null {
    if (!rebuildIndex() || !sentences.length) return null
    const restored = fromWordIndex ?? restoreWordIndex() ?? (activeIndex.value >= 0 ? activeIndex.value : 0)
    return Math.min(Math.max(0, restored), Math.max(0, words.length - 1))
  }

  async function prefetchPlaybackAhead(fromWordIndex?: number) {
    await warmUp()
    const provider = resolveProvider(settings().ttsProvider)
    if (!isProviderConfigured(provider)) return
    if (provider === 'browser') return

    const wordIndex = resolvePrefetchWordIndex(fromWordIndex)
    if (wordIndex === null) return

    const startSentenceIdx = Math.max(
      0,
      sentences.findIndex((sentence) => wordIndex >= sentence.wordStartIdx && wordIndex < sentence.wordEndIdxExclusive),
    )
    const playbackQueue = buildPlaybackQueue(startSentenceIdx, wordIndex)
    const toPrefetch = playbackQueue.slice(0, Math.min(AUDIO_PREFETCH_SENTENCE_COUNT + 1, playbackQueue.length))
    if (!toPrefetch.length) return

    const ctx = new AudioContext({ latencyHint: 'interactive' })
    await ctx.resume().catch(() => {})
    try {
      if (provider === 'azure' && credentials.azureKey) {
        const sdk = await getAzureSdk()
        for (const sentence of toPrefetch) {
          void getOrCreatePreparedAudio(preparedAudioCacheKey(sentence, provider), () => synthesizeAzureSentence(sentence, ctx, sdk)).catch(() => {})
        }
        return
      }

      if (isCloudPrefetchProvider(provider)) {
        const fetchAudio = cloudAudioFetcher(provider)
        const stubRuntime = DEFAULT_RUNTIME()
        for (const sentence of toPrefetch) {
          void getOrCreatePreparedAudio(preparedAudioCacheKey(sentence, provider), () =>
            prepareCloudAudioSentence(sentence, stubRuntime, ctx, fetchAudio, provider),
          ).catch(() => {})
        }
      }
    } finally {
      await ctx.close().catch(() => {})
    }
  }

  function sentenceStartForWord(wordIndex: number): number | null {
    if (!sentences.length && !rebuildIndex()) return null
    return findSentenceForWord(sentences, wordIndex)?.wordStartIdx ?? null
  }

  function trackActiveWordIndex(index: number) {
    savedWordIndex = index
    savedResumeKey = resumeStorageKey()
  }

  function persistTtsPosition(wordIndex: number) {
    if (!Number.isInteger(wordIndex) || wordIndex < 0) return
    const key = resumeStorageKey()
    if (key) localStorage.setItem(key, String(wordIndex))
    options.onTtsWordIndexChange?.(wordIndex)
    if (!userStoppedPlayback && status.value !== 'idle') {
      const wasPlaying = status.value === 'speaking' || status.value === 'loading'
      syncPlaybackSession(wasPlaying, wordIndex, true)
    }
  }

  function persistAtSentenceBoundary(wordIndex: number) {
    const sentenceStart = sentenceStartForWord(wordIndex)
    if (sentenceStart === null || sentenceStart === lastPersistedSentenceStart) return
    lastPersistedSentenceStart = sentenceStart
    persistTtsPosition(sentenceStart)
    options.onTtsCheckpoint?.()
  }

  function markProgrammaticScroll(durationMs = 700) {
    programmaticScrollUntil = performance.now() + durationMs
  }

  function scrollToActiveWord(behavior: ScrollBehavior = 'smooth') {
    const currentRoot = root ?? activeRoot()
    if (!currentRoot) return
    markProgrammaticScroll(behavior === 'instant' ? 120 : 700)
    scrollActiveWordIntoView(currentRoot, behavior, options.getFoliateRenderer?.() ?? null)
  }

  function detachScrollFollow() {
    scrollFollowEnabled.value = false
  }

  function onUserScrollIntent() {
    if (!scrollFollowEnabled.value || !isActive.value) return
    detachScrollFollow()
  }

  function evaluateScrollFollow() {
    scrollFollowEvalTimer = null
    if (!scrollFollowEnabled.value || !isActive.value) return
    if (status.value !== 'speaking' && status.value !== 'loading' && status.value !== 'paused') return
    if (performance.now() < programmaticScrollUntil) return

    const currentRoot = root ?? activeRoot()
    if (!currentRoot) return
    if (!isActiveWordInStickyViewport(currentRoot, 0.42, options.getFoliateRenderer?.() ?? null)) {
      detachScrollFollow()
    }
  }

  function scheduleScrollFollowEvaluation() {
    if (scrollFollowEvalTimer !== null) clearTimeout(scrollFollowEvalTimer)
    scrollFollowEvalTimer = setTimeout(evaluateScrollFollow, 120)
  }

  function onReaderWheel(event: WheelEvent) {
    const delta = Math.max(Math.abs(event.deltaY), Math.abs(event.deltaX))
    if (delta > 0) onUserScrollIntent()
  }

  function onReaderTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) {
      touchScrollStartY = null
      return
    }
    touchScrollStartY = event.touches[0]?.clientY ?? null
  }

  function onReaderTouchMove(event: TouchEvent) {
    if (touchScrollStartY === null || event.touches.length !== 1) return
    const y = event.touches[0]?.clientY
    if (y == null) return
    if (Math.abs(y - touchScrollStartY) >= 6) onUserScrollIntent()
  }

  function onReaderTouchEnd() {
    touchScrollStartY = null
  }

  function onFoliateScroll() {
    if (performance.now() < programmaticScrollUntil) return
    scheduleScrollFollowEvaluation()
  }

  function detachScrollFollowListeners(doc: Document) {
    scrollListenerCleanupByDoc.get(doc)?.()
    scrollListenerCleanupByDoc.delete(doc)
  }

  function attachScrollFollowListeners(doc: Document) {
    if (scrollListenerCleanupByDoc.has(doc)) return
    const win = doc.defaultView
    if (!win) return

    const scrollTargets = collectScrollTargets(doc)
    for (const target of scrollTargets) {
      target.addEventListener('scroll', onFoliateScroll, { passive: true, capture: true })
    }
    win.addEventListener('wheel', onReaderWheel, { passive: true, capture: true })
    win.addEventListener('touchstart', onReaderTouchStart, { passive: true, capture: true })
    win.addEventListener('touchmove', onReaderTouchMove, { passive: true, capture: true })
    win.addEventListener('touchend', onReaderTouchEnd, { passive: true, capture: true })
    win.addEventListener('touchcancel', onReaderTouchEnd, { passive: true, capture: true })

    scrollListenerCleanupByDoc.set(doc, () => {
      for (const target of scrollTargets) {
        target.removeEventListener('scroll', onFoliateScroll, true)
      }
      win.removeEventListener('wheel', onReaderWheel, true)
      win.removeEventListener('touchstart', onReaderTouchStart, true)
      win.removeEventListener('touchmove', onReaderTouchMove, true)
      win.removeEventListener('touchend', onReaderTouchEnd, true)
      win.removeEventListener('touchcancel', onReaderTouchEnd, true)
    })
  }

  /** Foliate scrolls a shadow paginator; user wheels hit the shell document instead. */
  function attachFoliateShellScrollListeners() {
    if (foliateShellScrollCleanup) return

    const onRelocate = () => scheduleScrollFollowEvaluation()

    const view = document.querySelector('foliate-view')
    view?.addEventListener('scroll', onFoliateScroll, { passive: true })
    view?.addEventListener('relocate', onRelocate, { passive: true })
    document.addEventListener('wheel', onReaderWheel, { passive: true, capture: true })
    document.addEventListener('touchstart', onReaderTouchStart, { passive: true, capture: true })
    document.addEventListener('touchmove', onReaderTouchMove, { passive: true, capture: true })
    document.addEventListener('touchend', onReaderTouchEnd, { passive: true, capture: true })
    document.addEventListener('touchcancel', onReaderTouchEnd, { passive: true, capture: true })

    foliateShellScrollCleanup = () => {
      view?.removeEventListener('scroll', onFoliateScroll)
      view?.removeEventListener('relocate', onRelocate)
      document.removeEventListener('wheel', onReaderWheel, true)
      document.removeEventListener('touchstart', onReaderTouchStart, true)
      document.removeEventListener('touchmove', onReaderTouchMove, true)
      document.removeEventListener('touchend', onReaderTouchEnd, true)
      document.removeEventListener('touchcancel', onReaderTouchEnd, true)
      foliateShellScrollCleanup = null
    }
  }

  function resetScrollFollow() {
    scrollFollowEnabled.value = true
  }

  function resumeScrollFollow() {
    scrollFollowEnabled.value = true
    const currentRoot = root ?? activeRoot()
    if (!currentRoot || activeIndex.value < 0) return
    scrollToActiveWord('instant')
  }

  function setActiveWord(index: number) {
    const currentRoot = root ?? activeRoot()
    if (!currentRoot || !words[index]) return
    activeIndex.value = index
    trackActiveWordIndex(index)
    persistAtSentenceBoundary(index)
    highlightWord(currentRoot, words, sentences, index)
    if (scrollFollowEnabled.value) {
      const behavior = status.value === 'speaking' || status.value === 'loading' ? 'instant' : 'smooth'
      scrollToActiveWord(behavior)
    }
  }

  function resumeStorageKey(): string | null {
    const key = options.getResumeKey?.()
    return key ? `reader:epub-tts:${key}` : null
  }

  function currentSectionIndex(): number | undefined {
    return options.getCurrentSectionIndex?.()
  }

  function syncPlaybackSession(wasPlaying: boolean, wordIndex = activeIndex.value, enabled = true) {
    const sectionIndex = currentSectionIndex()
    if (sectionIndex === undefined) return
    const effectiveWordIndex = wordIndex >= 0 ? wordIndex : (restoreWordIndex() ?? 0)
    writeTtsPlaybackSession(options.fileId, {
      enabled,
      wasPlaying,
      sectionIndex,
      wordIndex: effectiveWordIndex,
    })
    if (enabled) {
      ttsEnabled.value = true
      syncDisplayedProvider()
    }
  }

  function persistEnabledSession(context?: { sectionIndex?: number; wordIndex?: number; wasPlaying?: boolean }) {
    const existing = readTtsPlaybackSession(options.fileId)
    const section = context?.sectionIndex ?? currentSectionIndex() ?? existing?.sectionIndex
    if (section === undefined) return false

    const wordIndex = context?.wordIndex ?? (activeIndex.value >= 0 ? activeIndex.value : undefined) ?? restoreWordIndex() ?? existing?.wordIndex ?? 0

    let wasPlaying = context?.wasPlaying
    if (wasPlaying === undefined) {
      wasPlaying = status.value === 'speaking' || status.value === 'loading'
    }

    writeTtsPlaybackSession(options.fileId, {
      enabled: true,
      wasPlaying,
      sectionIndex: section,
      wordIndex: Math.max(0, wordIndex),
    })
    clearTtsUserStopped(options.fileId)
    ttsEnabled.value = true
    syncDisplayedProvider()
    return true
  }

  function resetResumeState() {
    savedWordIndex = null
    savedResumeKey = null
    lastPersistedSentenceStart = null
  }

  function clearPlaybackSession() {
    clearTtsPlaybackSession(options.fileId)
  }

  function syncMediaSession() {
    syncTtsMediaSession()
  }

  function restoreWordIndex(): number | null {
    const key = resumeStorageKey()
    const persisted = options.getPersistedTtsPosition?.()
    const currentSection = options.getCurrentSectionIndex?.()
    if (persisted && currentSection !== undefined && persisted.sectionIndex === currentSection) {
      savedWordIndex = persisted.wordIndex
      savedResumeKey = key ?? null
      if (key) localStorage.setItem(key, String(persisted.wordIndex))
      return savedWordIndex
    }

    if (key) {
      if (savedResumeKey === key && savedWordIndex !== null) return savedWordIndex
      savedResumeKey = key
      const raw = localStorage.getItem(key)
      const parsed = raw === null ? NaN : Number(raw)
      if (Number.isInteger(parsed) && parsed >= 0) {
        savedWordIndex = parsed
        return savedWordIndex
      }
      savedWordIndex = null
    }

    return null
  }

  function makePartialSentence(sentence: SentenceInfo, wordIndex: number): SentenceInfo {
    if (wordIndex <= sentence.wordStartIdx) return sentence
    return {
      text: words
        .slice(wordIndex, sentence.wordEndIdxExclusive)
        .map((entry) => entry.word)
        .join(' '),
      wordStartIdx: wordIndex,
      wordEndIdxExclusive: sentence.wordEndIdxExclusive,
    }
  }

  function buildPlaybackQueue(startSentenceIdx: number, wordIndex: number): SentenceInfo[] {
    return sentences.slice(startSentenceIdx).map((sentence, index) => (index === 0 ? makePartialSentence(sentence, wordIndex) : sentence))
  }

  function currentSentenceIndex(): number {
    return Math.max(
      0,
      sentences.findIndex((sentence) => activeIndex.value >= sentence.wordStartIdx && activeIndex.value < sentence.wordEndIdxExclusive),
    )
  }

  function playbackRunIsStale(runId: number): boolean {
    return runId !== playbackGeneration || userStoppedPlayback
  }

  function cleanupRuntime(clearHighlight = true) {
    const previous = runtime
    const previousSource = previous?.source
    if (previous) {
      previous.stopped = true
      previous.abort.abort()
    }
    if (previous?.rafId !== null && previous?.rafId !== undefined) cancelAnimationFrame(previous.rafId)
    if (previousSource) {
      try {
        previousSource.onended = null
        previousSource.stop()
      } catch {
        // ignore
      }
    }
    previous?.audioContext?.close().catch(() => {})
    runtime = null
    window.speechSynthesis?.cancel()
    if (clearHighlight && root) clearTtsHighlight(root)
  }

  /** Re-apply engine/voice/speed immediately whenever TTS settings change. */
  function applyTtsSettingsChange() {
    currentProvider.value = resolveCloudTtsProvider(null, settings().ttsProvider)
    if (!isActive.value) return

    playbackGeneration++
    cleanupRuntime(false)

    const hasPlaybackPosition = activeIndex.value >= 0 || restoreWordIndex() !== null
    if (!hasPlaybackPosition && status.value === 'idle') {
      void prefetchPlaybackAhead()
      return
    }

    void restartFromCurrentWord()
  }

  function playFromToolbar() {
    if (status.value === 'paused') {
      resume()
      return
    }
    if (status.value === 'loading') {
      void restartFromCurrentWord()
      return
    }
    void start(undefined, { userInitiated: true })
  }

  async function start(fromIndex?: number, startOptions: TtsStartOptions = { userInitiated: true }) {
    if (userStoppedPlayback && !startOptions.userInitiated) return

    playbackStartDepth++
    try {
      if (startOptions.userInitiated) {
        userStoppedPlayback = false
        clearTtsUserStopped(options.fileId)
        autoResumeAttempted = false
        resetScrollFollow()
        ttsEnabled.value = true
        syncDisplayedProvider()
        unsuppressTtsMediaSession()
        playbackGeneration++
        const sectionIndex = currentSectionIndex()
        if (sectionIndex !== undefined) {
          const initialWordIndex = fromIndex ?? restoreWordIndex() ?? 0
          writeTtsPlaybackSession(options.fileId, {
            enabled: true,
            wasPlaying: true,
            sectionIndex,
            wordIndex: Math.max(0, initialWordIndex),
          })
        }
      }

      const runId = playbackGeneration
      cleanupRuntime(false)
      error.value = null
      missingConfigWarned = false
      if (fromIndex === 0) {
        resetResumeState()
        clearPlaybackSession()
        const key = resumeStorageKey()
        if (key) localStorage.removeItem(key)
      }
      await warmUp()
      if (playbackRunIsStale(runId)) {
        if (startOptions.userInitiated && status.value === 'loading') status.value = 'idle'
        return
      }
      if (!rebuildIndex()) {
        error.value = 'No readable text found in the current section.'
        status.value = 'error'
        return
      }

      if (startOptions.userInitiated) {
        status.value = 'loading'
      }

      const restoredIndex = fromIndex ?? restoreWordIndex()
      const startIndex = Math.min(Math.max(0, restoredIndex ?? 0), Math.max(0, words.length - 1))
      const sentence = findSentenceForWord(sentences, startIndex)
      syncPlaybackSession(true, startIndex)
      await playFromSentence(sentence ? startIndex : (restoredIndex ?? startIndex), runId)
      if (playbackRunIsStale(runId)) return
      syncMediaSession()
    } finally {
      playbackStartDepth = Math.max(0, playbackStartDepth - 1)
    }
  }

  async function playFromSentence(wordIndex: number, runId = playbackGeneration) {
    const startSentenceIdx = Math.max(
      0,
      sentences.findIndex((sentence) => wordIndex >= sentence.wordStartIdx && wordIndex < sentence.wordEndIdxExclusive),
    )
    const activeRuntime = DEFAULT_RUNTIME()
    runtime = activeRuntime
    const effectiveProvider = requireConfiguredProvider(settings().ttsProvider)
    currentProvider.value = effectiveProvider
    const playbackQueue = buildPlaybackQueue(startSentenceIdx, wordIndex)
    setActiveWord(wordIndex)

    try {
      if (effectiveProvider === 'azure') {
        await playAzureAudioQueue(playbackQueue, activeRuntime)
      } else if (
        effectiveProvider === 'xai' ||
        effectiveProvider === 'gcp-chirp3' ||
        effectiveProvider === 'kokoro' ||
        effectiveProvider === 'gpt-4o-mini-tts'
      ) {
        const fetchAudio = cloudAudioFetcher(effectiveProvider)
        await playPreparedAudioQueue(playbackQueue, activeRuntime, (sentence, runtime, ctx) =>
          prepareCloudAudioSentence(sentence, runtime, ctx, fetchAudio, effectiveProvider),
        )
      } else {
        for (const sentence of playbackQueue) {
          if (runtimeIsInactive(activeRuntime) || playbackRunIsStale(runId)) return
          currentSentenceText.value = sentence.text
          setActiveWord(sentence.wordStartIdx)
          status.value = 'loading'
          await speakSentence(sentence, activeRuntime, effectiveProvider)
        }
      }
      if (playbackRunIsStale(runId)) return
      if (runtime === activeRuntime && !activeRuntime.stopped) {
        status.value = 'done'
        currentSentenceText.value = ''
        syncMediaSession()
        options.onSectionComplete?.()
      }
    } catch (err) {
      if (runtime !== activeRuntime || activeRuntime.stopped || activeRuntime.abort.signal.aborted) {
        if (status.value === 'loading') status.value = 'idle'
        return
      }
      error.value = err instanceof Error ? err.message : 'TTS playback failed'
      status.value = 'error'
      syncMediaSession()
    }
  }

  async function speakSentence(
    sentence: SentenceInfo,
    activeRuntime: SpeechRuntime,
    effectiveProvider = requireConfiguredProvider(settings().ttsProvider),
  ): Promise<void> {
    currentProvider.value = effectiveProvider
    if (effectiveProvider === 'azure') return speakAzureSentence(sentence, activeRuntime)
    if (effectiveProvider === 'xai') return speakCloudAudioSentence(sentence, activeRuntime, fetchXaiAudio)
    if (effectiveProvider === 'gcp-chirp3') return speakCloudAudioSentence(sentence, activeRuntime, fetchGcpAudio)
    if (effectiveProvider === 'kokoro') return speakCloudAudioSentence(sentence, activeRuntime, fetchKokoroAudio)
    if (effectiveProvider === 'gpt-4o-mini-tts') return speakCloudAudioSentence(sentence, activeRuntime, fetchGpt4oMiniTtsAudio)
    throw new Error(`${providerDisplayName(effectiveProvider)} is not supported for text-to-speech.`)
  }

  function cloudAudioFetcher(provider: TtsProvider): CloudAudioFetcher {
    if (provider === 'gcp-chirp3') return fetchGcpAudio
    if (provider === 'kokoro') return fetchKokoroAudio
    if (provider === 'gpt-4o-mini-tts') return fetchGpt4oMiniTtsAudio
    return fetchXaiAudio
  }

  function providerDisplayName(provider: TtsProvider): string {
    const cloud = resolveCloudTtsProvider(provider, settings().ttsProvider)
    if (cloud === 'gcp-chirp3') return 'Google Chirp 3'
    if (cloud === 'azure') return 'Azure'
    if (cloud === 'kokoro') return 'Kokoro'
    if (cloud === 'gpt-4o-mini-tts') return 'GPT'
    if (cloud === 'xai') return 'xAI'
    return 'Kokoro'
  }

  function syncDisplayedProvider() {
    currentProvider.value = resolveCloudTtsProvider(currentProvider.value, settings().ttsProvider)
  }

  function isProviderConfigured(provider: TtsProvider): boolean {
    if (provider === 'browser') return false
    if (provider === 'azure') return !!credentials.azureKey
    if (provider === 'gcp-chirp3') return credentials.gcpChirp3Configured
    if (provider === 'xai') return credentials.xaiConfigured
    if (provider === 'kokoro' || provider === 'gpt-4o-mini-tts') return credentials.kokoroConfigured
    return false
  }

  function resolveProvider(provider: TtsProvider): TtsProvider {
    return provider
  }

  function requireConfiguredProvider(provider: TtsProvider): TtsProvider {
    if (isProviderConfigured(provider)) return provider

    const adminHint = 'Ask an admin to configure API keys in Settings → System → Text-to-Speech.'
    const message =
      provider === 'browser'
        ? `Device text-to-speech is not available. Choose a cloud engine in TTS settings. ${adminHint}`
        : `${providerDisplayName(provider)} is not configured. ${adminHint}`
    warnMissingConfig(message)
    throw new Error(message)
  }

  function warnMissingConfig(message: string) {
    if (missingConfigWarned) return
    missingConfigWarned = true
    toast.warning(message)
  }

  function trackPlayedUsage(sentence: SentenceInfo) {
    const provider = currentProvider.value ?? resolveProvider(settings().ttsProvider)
    void reportUsage(provider, sentence.text.length)
  }

  function runtimeIsInactive(activeRuntime: SpeechRuntime): boolean {
    return runtime !== activeRuntime || activeRuntime.stopped || activeRuntime.abort.signal.aborted
  }

  function speakBrowserSentence(sentence: SentenceInfo, activeRuntime: SpeechRuntime): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error('Device text-to-speech is not available in this browser.'))
        return
      }
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(sentence.text)
      const s = settings()
      const selectedVoice = s.ttsVoice ? window.speechSynthesis.getVoices().find((voice) => voice.name === s.ttsVoice) : null
      if (selectedVoice) utterance.voice = selectedVoice
      utterance.rate = s.ttsRate
      utterance.pitch = s.ttsPitch
      utterance.volume = s.ttsVolume
      const wordEnds = localWordEndChars(sentence, words)
      utterance.onstart = () => {
        if (!activeRuntime.stopped) {
          status.value = 'speaking'
          trackPlayedUsage(sentence)
        }
      }
      utterance.onboundary = (event) => {
        if (activeRuntime.stopped || typeof event.charIndex !== 'number') return
        const localIdx = wordIndexForFraction(wordEnds, event.charIndex / Math.max(1, wordEnds[wordEnds.length - 1] ?? 1))
        setActiveWord(sentence.wordStartIdx + localIdx)
      }
      utterance.onerror = (event) => reject(new Error(`Device TTS failed: ${event.error || 'unknown error'}`))
      utterance.onend = () => resolve()
      window.speechSynthesis.speak(utterance)
    })
  }

  function createBrowserUtterance(sentence: SentenceInfo, activeRuntime: SpeechRuntime): SpeechSynthesisUtterance {
    const utterance = new SpeechSynthesisUtterance(sentence.text)
    const s = settings()
    const selectedVoice = s.ttsVoice ? window.speechSynthesis.getVoices().find((voice) => voice.name === s.ttsVoice) : null
    if (selectedVoice) utterance.voice = selectedVoice
    utterance.rate = s.ttsRate
    utterance.pitch = s.ttsPitch
    utterance.volume = s.ttsVolume
    const wordEnds = localWordEndChars(sentence, words)
    utterance.onstart = () => {
      if (activeRuntime.stopped) return
      currentSentenceText.value = sentence.text
      status.value = 'speaking'
      setActiveWord(sentence.wordStartIdx)
      trackPlayedUsage(sentence)
    }
    utterance.onboundary = (event) => {
      if (activeRuntime.stopped || typeof event.charIndex !== 'number') return
      const localIdx = wordIndexForFraction(wordEnds, event.charIndex / Math.max(1, wordEnds[wordEnds.length - 1] ?? 1))
      setActiveWord(sentence.wordStartIdx + localIdx)
    }
    return utterance
  }

  function playBrowserQueue(playbackQueue: SentenceInfo[], activeRuntime: SpeechRuntime): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error('Device text-to-speech is not available in this browser.'))
        return
      }
      if (!playbackQueue.length) {
        resolve()
        return
      }

      const synth = window.speechSynthesis
      let completed = 0
      let settled = false

      const settle = (err?: Error | DOMException) => {
        if (settled) return
        settled = true
        activeRuntime.abort.signal.removeEventListener('abort', abortHandler)
        if (err) reject(err)
        else resolve()
      }
      const abortHandler = () => {
        synth.cancel()
        settle(new DOMException('TTS aborted', 'AbortError'))
      }
      activeRuntime.abort.signal.addEventListener('abort', abortHandler, { once: true })

      synth.cancel()
      status.value = 'loading'
      for (const sentence of playbackQueue) {
        if (runtimeIsInactive(activeRuntime)) {
          settle(new DOMException('TTS aborted', 'AbortError'))
          return
        }
        const utterance = createBrowserUtterance(sentence, activeRuntime)
        utterance.onerror = (event) => settle(new Error(`Device TTS failed: ${event.error || 'unknown error'}`))
        utterance.onend = () => {
          completed++
          if (completed >= playbackQueue.length) settle()
        }
        synth.speak(utterance)
      }
    })
  }

  async function speakCloudAudioSentence(sentence: SentenceInfo, activeRuntime: SpeechRuntime, fetchAudio: CloudAudioFetcher): Promise<void> {
    const audioData = await fetchAudio(sentence, activeRuntime.abort.signal)
    const ctx = new AudioContext({ latencyHint: 'playback' })
    activeRuntime.audioContext = ctx
    await ctx.resume().catch(() => {})
    const buffer = trimAudioBufferSilence(ctx, await ctx.decodeAudioData(audioData.slice(0)))
    await playAudioBufferWithInterpolation(sentence, activeRuntime, ctx, buffer)
  }

  function queuePreparedAudio(sentence: SentenceInfo, activeRuntime: SpeechRuntime, ctx: AudioContext, buildAudio: PreparedAudioBuilder) {
    const pending = buildAudio(sentence, activeRuntime, ctx)
    pending.catch(() => {})
    return pending
  }

  async function prepareCloudAudioSentence(
    sentence: SentenceInfo,
    _activeRuntime: SpeechRuntime,
    ctx: AudioContext,
    fetchAudio: CloudAudioFetcher,
    provider: TtsProvider,
  ): Promise<PreparedAudio> {
    return getOrCreatePreparedAudio(preparedAudioCacheKey(sentence, provider), async () => {
      const audioData = await fetchAudio(sentence, new AbortController().signal)
      const buffer = trimAudioBufferSilence(ctx, await ctx.decodeAudioData(audioData.slice(0)))
      return { sentence, buffer }
    })
  }

  function playPreparedAudio(
    prepared: PreparedAudio,
    activeRuntime: SpeechRuntime,
    ctx: AudioContext,
    options: PlayAudioBufferOptions = {},
  ): Promise<void> {
    if (prepared.boundaries && prepared.charStarts) {
      return playAudioBufferWithBoundaries(prepared.sentence, activeRuntime, ctx, prepared.buffer, prepared.boundaries, prepared.charStarts, options)
    }
    return playAudioBufferWithInterpolation(prepared.sentence, activeRuntime, ctx, prepared.buffer, options)
  }

  async function playPreparedAudioQueue(playbackQueue: SentenceInfo[], activeRuntime: SpeechRuntime, buildAudio: PreparedAudioBuilder) {
    const ctx = new AudioContext({ latencyHint: 'playback' })
    activeRuntime.audioContext = ctx
    await ctx.resume().catch(() => {})

    const pending = new Map<number, Promise<PreparedAudio>>()
    const queueAhead = (fromIndex: number) => {
      const endIndex = Math.min(playbackQueue.length, fromIndex + AUDIO_PREFETCH_SENTENCE_COUNT)
      for (let idx = fromIndex; idx < endIndex; idx++) {
        if (!pending.has(idx)) {
          pending.set(idx, queuePreparedAudio(playbackQueue[idx]!, activeRuntime, ctx, buildAudio))
        }
      }
    }
    queueAhead(0)

    try {
      for (let i = 0; i < playbackQueue.length; i++) {
        const preparedAudio = pending.get(i)
        if (runtimeIsInactive(activeRuntime) || playbackRunIsStale(playbackGeneration)) {
          if (status.value === 'loading') status.value = 'idle'
          return
        }
        if (!preparedAudio) {
          error.value = 'TTS playback was interrupted.'
          status.value = 'error'
          return
        }
        const sentence = playbackQueue[i]!
        currentSentenceText.value = sentence.text
        setActiveWord(sentence.wordStartIdx)
        status.value = 'loading'

        const prepared = await preparedAudio
        pending.delete(i)
        if (runtimeIsInactive(activeRuntime)) return

        queueAhead(i + 1)

        status.value = 'loading'
        await playPreparedAudio({ ...prepared, sentence }, activeRuntime, ctx, { closeContextOnEnd: false })
      }
    } finally {
      if (activeRuntime.audioContext === ctx) activeRuntime.audioContext = null
      await ctx.close().catch(() => {})
    }
  }

  async function prepareAzureAudioSentence(sentence: SentenceInfo, activeRuntime: SpeechRuntime, ctx: AudioContext): Promise<PreparedAudio> {
    const sdk = await getAzureSdk()
    return prepareAzureAudioSentenceWithSdk(sentence, ctx, sdk, activeRuntime)
  }

  async function playAzureAudioQueue(playbackQueue: SentenceInfo[], activeRuntime: SpeechRuntime) {
    const sdk = await getAzureSdk()
    await playPreparedAudioQueue(playbackQueue, activeRuntime, (sentence, runtime, ctx) =>
      prepareAzureAudioSentenceWithSdk(sentence, ctx, sdk, runtime),
    )
  }

  async function synthesizeAzureSentence(sentence: SentenceInfo, ctx: AudioContext, sdk: AzureSpeechSdk): Promise<PreparedAudio> {
    return prepareAzureAudioSentenceWithSdk(sentence, ctx, sdk)
  }

  async function prepareAzureAudioSentenceWithSdk(
    sentence: SentenceInfo,
    ctx: AudioContext,
    sdk: AzureSpeechSdk,
    _activeRuntime?: SpeechRuntime,
  ): Promise<PreparedAudio> {
    const s = settings()
    const region = credentials.azureRegion
    if (!region) throw new Error('Azure region is required.')

    return getOrCreatePreparedAudio(preparedAudioCacheKey(sentence, 'azure'), async () => {
      const localWords = words.slice(sentence.wordStartIdx, sentence.wordEndIdxExclusive)
      const escapedWords = localWords.map((entry) => xmlEscape(entry.word))
      const escapedText = escapedWords.join(' ')
      const rate = Math.max(0.5, Math.min(3, s.ttsRate))
      const voice = s.ttsAzureVoice || AZURE_DEFAULT_VOICE
      const prefix =
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` + `<voice name="${voice}"><prosody rate="${rate}">`
      const suffix = '</prosody></voice></speak>'
      const ssml = `${prefix}${escapedText}${suffix}`
      const charStarts: number[] = []
      let cursor = 0
      for (const word of escapedWords) {
        charStarts.push(cursor)
        cursor += word.length + 1
      }

      const speechConfig = sdk.SpeechConfig.fromSubscription(credentials.azureKey, region)
      speechConfig.speechSynthesisVoiceName = voice
      speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3
      const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null)
      const boundaries: Array<{ offset: number; audioOffsetSec: number }> = []
      synthesizer.wordBoundary = (_sender, event) => {
        if (event.boundaryType !== sdk.SpeechSynthesisBoundaryType.Word) return
        boundaries.push({
          offset: Math.max(0, event.textOffset - prefix.length),
          audioOffsetSec: event.audioOffset / 10_000_000,
        })
      }

      const audioData = await new Promise<ArrayBuffer>((resolve, reject) => {
        synthesizer.speakSsmlAsync(
          ssml,
          (result) => {
            synthesizer.close()
            if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              resolve(result.audioData)
              return
            }
            const details = sdk.CancellationDetails.fromResult(result)
            reject(new Error(details.errorDetails || 'Azure synthesis failed'))
          },
          (err) => {
            synthesizer.close()
            reject(new Error(String(err)))
          },
        )
      })

      const buffer = trimAudioBufferSilence(ctx, await ctx.decodeAudioData(audioData.slice(0)))
      return { sentence, buffer, boundaries, charStarts }
    })
  }

  async function speakAzureSentence(sentence: SentenceInfo, activeRuntime: SpeechRuntime): Promise<void> {
    const ctx = new AudioContext({ latencyHint: 'playback' })
    activeRuntime.audioContext = ctx
    await ctx.resume().catch(() => {})
    const prepared = await prepareAzureAudioSentence(sentence, activeRuntime, ctx)
    await playPreparedAudio(prepared, activeRuntime, ctx)
  }

  function playAudioBufferWithInterpolation(
    sentence: SentenceInfo,
    activeRuntime: SpeechRuntime,
    ctx: AudioContext,
    buffer: AudioBuffer,
    options?: PlayAudioBufferOptions,
  ) {
    const wordEnds = localWordEndChars(sentence, words)
    return playAudioBuffer(
      sentence,
      activeRuntime,
      ctx,
      buffer,
      () => {
        const elapsed = ctx.currentTime - startTime
        const fraction = Math.min(1, Math.max(0, elapsed / Math.max(0.01, buffer.duration)))
        return sentence.wordStartIdx + wordIndexForFraction(wordEnds, fraction)
      },
      options,
    )
  }

  function playAudioBufferWithBoundaries(
    sentence: SentenceInfo,
    activeRuntime: SpeechRuntime,
    ctx: AudioContext,
    buffer: AudioBuffer,
    boundaries: Array<{ offset: number; audioOffsetSec: number }>,
    charStarts: number[],
    options?: PlayAudioBufferOptions,
  ) {
    let boundaryIdx = 0
    let lastIndex = sentence.wordStartIdx
    return playAudioBuffer(
      sentence,
      activeRuntime,
      ctx,
      buffer,
      () => {
        const elapsed = ctx.currentTime - startTime
        while (boundaryIdx < boundaries.length && boundaries[boundaryIdx]!.audioOffsetSec <= elapsed) {
          const boundary = boundaries[boundaryIdx]!
          boundaryIdx++
          let localIdx = 0
          for (let i = 0; i < charStarts.length; i++) {
            if (charStarts[i]! <= boundary.offset) localIdx = i
            else break
          }
          lastIndex = sentence.wordStartIdx + localIdx
        }
        return lastIndex
      },
      options,
    )
  }

  let startTime = 0
  function playAudioBuffer(
    sentence: SentenceInfo,
    activeRuntime: SpeechRuntime,
    ctx: AudioContext,
    buffer: AudioBuffer,
    wordResolver: () => number,
    options: PlayAudioBufferOptions = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const source = ctx.createBufferSource()
      const { gain } = createTtsOutputChain(ctx, settings().ttsVolume)
      const closeContextOnEnd = options.closeContextOnEnd ?? true
      let settled = false
      activeRuntime.source = source
      source.buffer = buffer
      source.connect(gain)
      startTime = ctx.currentTime + 0.01
      let lastWord = sentence.wordStartIdx
      const tick = () => {
        if (activeRuntime.stopped || activeRuntime.abort.signal.aborted) return
        if (ctx.state !== 'suspended') {
          const nextWord = Math.min(sentence.wordEndIdxExclusive - 1, Math.max(sentence.wordStartIdx, wordResolver()))
          if (nextWord !== lastWord) {
            lastWord = nextWord
            setActiveWord(nextWord)
          }
        }
        activeRuntime.rafId = requestAnimationFrame(tick)
      }

      const settle = (err?: Error | DOMException) => {
        if (settled) return
        settled = true
        activeRuntime.abort.signal.removeEventListener('abort', abortHandler)
        if (activeRuntime.rafId !== null) cancelAnimationFrame(activeRuntime.rafId)
        activeRuntime.rafId = null
        try {
          source.disconnect()
        } catch {
          // ignore
        }
        try {
          gain.disconnect()
        } catch {
          // ignore
        }
        if (activeRuntime.source === source) activeRuntime.source = null
        if (closeContextOnEnd) {
          if (activeRuntime.audioContext === ctx) activeRuntime.audioContext = null
          ctx.close().catch(() => {})
        }
        if (err) reject(err)
        else resolve()
      }

      const abortHandler = () => settle(new DOMException('TTS aborted', 'AbortError'))
      activeRuntime.abort.signal.addEventListener('abort', abortHandler, { once: true })
      source.onended = () => {
        if (activeRuntime.stopped || activeRuntime.abort.signal.aborted || userStoppedPlayback) {
          settle(new DOMException('TTS aborted', 'AbortError'))
        } else settle()
      }
      if (userStoppedPlayback || activeRuntime.stopped || activeRuntime.abort.signal.aborted) {
        settle(new DOMException('TTS aborted', 'AbortError'))
        return
      }
      status.value = 'speaking'
      trackPlayedUsage(sentence)
      setActiveWord(sentence.wordStartIdx)
      source.start(startTime)
      activeRuntime.rafId = requestAnimationFrame(tick)
    })
  }

  async function fetchXaiAudio(sentence: SentenceInfo, signal: AbortSignal): Promise<ArrayBuffer> {
    const response = await api('/api/v1/tts/xai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        voice: settings().ttsXaiVoice || XAI_DEFAULT_VOICE,
        text: sentence.text,
        language: options.bookLanguage.value || 'en',
        speed: settings().ttsRate,
      }),
    })
    if (!response.ok) throw new Error((await response.text().catch(() => '')) || 'xAI TTS failed')
    return response.arrayBuffer()
  }

  async function fetchGcpAudio(sentence: SentenceInfo, signal: AbortSignal): Promise<ArrayBuffer> {
    const response = await api('/api/v1/tts/gcp-chirp3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        voice: settings().ttsGcpChirp3Voice || GCP_CHIRP3_DEFAULT_VOICE,
        text: sentence.text,
        languageCode: 'en-US',
        speakingRate: settings().ttsRate,
      }),
    })
    if (!response.ok) throw new Error((await response.text().catch(() => '')) || 'Google TTS failed')
    return response.arrayBuffer()
  }

  async function fetchKokoroAudio(sentence: SentenceInfo, signal: AbortSignal): Promise<ArrayBuffer> {
    const response = await api('/api/v1/tts/kokoro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        voice: settings().ttsKokoroVoice || KOKORO_DEFAULT_VOICE,
        text: sentence.text,
        speed: settings().ttsRate,
      }),
    })
    if (!response.ok) throw new Error((await response.text().catch(() => '')) || 'Kokoro TTS failed')
    return response.arrayBuffer()
  }

  async function fetchGpt4oMiniTtsAudio(sentence: SentenceInfo, signal: AbortSignal): Promise<ArrayBuffer> {
    const response = await api('/api/v1/tts/gpt-4o-mini-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        voice: settings().ttsGpt4oMiniVoice || GPT_4O_MINI_TTS_DEFAULT_VOICE,
        text: sentence.text,
        speed: settings().ttsRate,
      }),
    })
    if (!response.ok) throw new Error((await response.text().catch(() => '')) || 'GPT TTS failed')
    return response.arrayBuffer()
  }

  function resolveSentenceStartWordIndex(wordIndex: number): number {
    return sentenceStartForWord(wordIndex) ?? wordIndex
  }

  /** Persist and return the first word index of the sentence containing `wordIndex`. */
  function checkpointAtSentenceStart(wordIndex = activeIndex.value): number | null {
    if (!Number.isInteger(wordIndex) || wordIndex < 0) return null
    const sentenceStart = resolveSentenceStartWordIndex(wordIndex)
    lastPersistedSentenceStart = sentenceStart
    persistTtsPosition(sentenceStart)
    options.onTtsCheckpoint?.()
    return sentenceStart
  }

  function checkpointTtsPosition() {
    checkpointAtSentenceStart()
  }

  function hasResumablePlayback(): boolean {
    if (!runtime || runtime.stopped) return false
    if (currentProvider.value === 'browser') return Boolean(window.speechSynthesis?.paused)
    return runtime.audioContext?.state === 'suspended' && runtime.source != null
  }

  function pause() {
    if (status.value !== 'speaking' && status.value !== 'loading') return
    if (status.value === 'loading' && !hasResumablePlayback()) return
    if (currentProvider.value === 'browser') window.speechSynthesis.pause()
    runtime?.audioContext?.suspend().catch(() => {})
    status.value = 'paused'
    const sentenceStart = checkpointAtSentenceStart() ?? activeIndex.value
    syncPlaybackSession(false, sentenceStart, true)
    syncMediaSession()
  }

  function resume() {
    if (userStoppedPlayback || status.value !== 'paused') return
    if (!hasResumablePlayback()) {
      restartFromCurrentWord()
      return
    }
    if (currentProvider.value === 'browser') window.speechSynthesis.resume()
    runtime?.audioContext?.resume().catch(() => {})
    status.value = 'speaking'
    syncPlaybackSession(true, activeIndex.value, true)
    syncMediaSession()
  }

  function stop(stopOptions?: { checkpoint?: boolean }) {
    userStoppedPlayback = true
    ttsEnabled.value = false
    markTtsUserStopped(options.fileId)
    playbackGeneration++
    autoResumeAttempted = true
    clearPlaybackSession()
    suppressTtsMediaSession()
    if (stopOptions?.checkpoint !== false) checkpointTtsPosition()
    cleanupRuntime(true)
    window.speechSynthesis?.cancel()
    status.value = 'idle'
    activeIndex.value = -1
    currentSentenceText.value = ''
    error.value = null
    syncMediaSession()
  }

  /** Persist TTS enabled state when navigating away without tearing down playback UI. */
  function persistForNavigation(context?: { sectionIndex?: number; wordIndex?: number }) {
    const existing = readTtsPlaybackSession(options.fileId)
    const shouldPersist = ttsEnabled.value || status.value !== 'idle' || existing?.enabled
    if (!shouldPersist) return

    persistEnabledSession({
      sectionIndex: context?.sectionIndex,
      wordIndex: context?.wordIndex,
      wasPlaying: false,
    })
  }

  /** @deprecated Use persistForNavigation(). */
  function leaveReader(context?: { sectionIndex?: number; wordIndex?: number }) {
    persistForNavigation(context)
  }

  /** @deprecated Use persistForNavigation(). */
  function suspend() {
    persistForNavigation()
  }

  function persistTtsSessionOnExit() {
    if (userStoppedPlayback || (!ttsEnabled.value && status.value === 'idle')) return
    if (status.value !== 'idle') {
      checkpointTtsPosition()
    }
    const wasPlaying = status.value === 'speaking' || status.value === 'loading'
    persistEnabledSession({ wasPlaying })
  }

  function replay() {
    if (status.value === 'idle') return
    void start(0, { userInitiated: true })
  }

  function restartFromCurrentWord() {
    const startIndex = activeIndex.value >= 0 ? activeIndex.value : restoreWordIndex()
    void start(startIndex ?? undefined, { userInitiated: false })
  }

  async function seekToWord(wordIndex: number) {
    userStoppedPlayback = false
    clearTtsUserStopped(options.fileId)
    unsuppressTtsMediaSession()
    playbackGeneration++
    const runId = playbackGeneration
    cleanupRuntime(false)
    error.value = null

    if (!rebuildIndex()) {
      error.value = 'No readable text found in the current section.'
      status.value = 'error'
      return
    }

    const startIndex = Math.min(Math.max(0, wordIndex), Math.max(0, words.length - 1))
    const sentenceStart = resolveSentenceStartWordIndex(startIndex)
    lastPersistedSentenceStart = sentenceStart
    persistTtsPosition(sentenceStart)
    options.onTtsCheckpoint?.()
    syncPlaybackSession(true, sentenceStart)
    await playFromSentence(startIndex, runId)
    if (playbackRunIsStale(runId)) return
    syncMediaSession()
  }

  function skipBackward() {
    if (!sentences.length && !rebuildIndex()) return
    const target = sentences[Math.max(0, currentSentenceIndex() - 1)]
    if (target) void seekToWord(target.wordStartIdx)
  }

  function skipForward() {
    if (!sentences.length && !rebuildIndex()) return
    const target = sentences[Math.min(sentences.length - 1, currentSentenceIndex() + 1)]
    if (target) void seekToWord(target.wordStartIdx)
  }

  function resolveRestoreWordIndex(): number | null {
    if (activeIndex.value >= 0) return activeIndex.value
    const restored = restoreWordIndex()
    if (restored !== null) return restored
    const session = readTtsPlaybackSession(options.fileId)
    if (!session?.enabled) return null
    const section = currentSectionIndex()
    if (section === undefined || session.sectionIndex !== section) return null
    return session.wordIndex
  }

  function cancelScheduledHighlightRestore() {
    if (highlightRestoreTimer !== null) {
      clearTimeout(highlightRestoreTimer)
      highlightRestoreTimer = null
    }
    if (highlightRestoreFrame !== 0) {
      cancelAnimationFrame(highlightRestoreFrame)
      highlightRestoreFrame = 0
    }
  }

  function restoreHighlightFromSession(): boolean {
    if (!ttsEnabled.value) return false
    if (!rebuildIndex(true)) return false
    const wordIndex = resolveRestoreWordIndex()
    if (wordIndex === null || wordIndex < 0) return false
    setActiveWord(wordIndex)
    if (scrollFollowEnabled.value) {
      requestAnimationFrame(() => scrollToActiveWord('instant'))
    }
    return true
  }

  function scheduleTtsHighlightRestore() {
    if (!ttsEnabled.value) return
    cancelScheduledHighlightRestore()

    let attemptsLeft = 24

    const tryRestore = () => {
      highlightRestoreTimer = null
      if (!ttsEnabled.value) return
      if (restoreHighlightFromSession()) return
      attemptsLeft -= 1
      if (attemptsLeft <= 0) return
      highlightRestoreTimer = setTimeout(tryRestore, 50)
    }

    highlightRestoreFrame = requestAnimationFrame(() => {
      highlightRestoreFrame = requestAnimationFrame(() => {
        highlightRestoreFrame = 0
        tryRestore()
      })
    })
  }

  function restoreHighlightForActiveWord() {
    scheduleTtsHighlightRestore()
  }

  function refreshTtsHighlight() {
    if (!ttsEnabled.value) return
    scheduleTtsHighlightRestore()
  }

  function handleDocumentLoad(doc: Document) {
    injectTtsHighlightStyles(doc, settings().ttsSentenceHighlightColor, settings().ttsWordHighlightColor)
    attachTapToRead(doc)
    attachScrollFollowListeners(doc)
    attachFoliateShellScrollListeners()

    const sectionIndex = currentSectionIndex()
    const isSameSectionReload = sectionIndex !== undefined && sectionIndex === loadedDocumentSectionIndex
    loadedDocumentSectionIndex = sectionIndex ?? null

    if (isSameSectionReload) {
      if (ttsEnabled.value) {
        scheduleTtsHighlightRestore()
        return
      }
      if (status.value === 'speaking' || status.value === 'loading' || status.value === 'paused') {
        restoreHighlightForActiveWord()
        return
      }
      void prefetchPlaybackAhead()
      return
    }

    words = []
    sentences = []
    wordCount.value = 0
    warmUpPromise = null

    if (status.value === 'speaking' || status.value === 'loading') {
      resetResumeState()
      const nextSection = currentSectionIndex()
      if (nextSection !== undefined) {
        writeTtsPlaybackSession(options.fileId, {
          enabled: true,
          wasPlaying: false,
          sectionIndex: nextSection,
          wordIndex: 0,
        })
        ttsEnabled.value = true
      }
      playbackGeneration++
      cleanupRuntime(true)
      window.speechSynthesis?.cancel()
      status.value = 'idle'
      activeIndex.value = -1
      currentSentenceText.value = ''
      error.value = null
      suppressTtsMediaSession()
      syncMediaSession()
      void prefetchPlaybackAhead()
      return
    }

    if (ttsEnabled.value) {
      scheduleTtsHighlightRestore()
      void prefetchPlaybackAhead()
      return
    }

    void prefetchPlaybackAhead()
  }

  async function waitForTtsStatus(targets: TtsStatus[], timeoutMs = 5000): Promise<boolean> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (targets.includes(status.value)) return true
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    return targets.includes(status.value)
  }

  function onAudioOutputChanged() {
    if (userStoppedPlayback || status.value === 'idle' || status.value === 'done' || status.value === 'error') {
      window.speechSynthesis?.cancel()
      if (userStoppedPlayback) cleanupRuntime(false)
      return
    }

    if (status.value === 'paused') {
      window.speechSynthesis?.pause()
      void runtime?.audioContext?.suspend().catch(() => {})
    }
  }

  async function restoreTtsReadyState(session: TtsPlaybackSession): Promise<boolean> {
    await warmUp()
    if (!rebuildIndex()) return false

    ttsEnabled.value = true
    syncDisplayedProvider()
    status.value = 'idle'
    if (!restoreHighlightFromSession()) {
      const wordIndex = Math.min(Math.max(0, session.wordIndex), Math.max(0, words.length - 1))
      setActiveWord(wordIndex)
    }
    scheduleTtsHighlightRestore()
    syncMediaSession()
    void prefetchPlaybackAhead(session.wordIndex)
    writeTtsPlaybackSession(options.fileId, {
      enabled: true,
      wasPlaying: false,
      sectionIndex: session.sectionIndex,
      wordIndex: Math.max(0, activeIndex.value >= 0 ? activeIndex.value : session.wordIndex),
    })
    return activeIndex.value >= 0
  }

  function resolveRestoredTtsSession(session: TtsPlaybackSession): TtsPlaybackSession {
    const persisted = options.getPersistedTtsPosition?.()
    if (!persisted) return session
    return {
      ...session,
      sectionIndex: persisted.sectionIndex,
      wordIndex: persisted.wordIndex,
    }
  }

  async function restoreTtsAfterReload(): Promise<'resumed' | 'ready' | false> {
    if (autoResumeAttempted || userStoppedPlayback || readTtsUserStopped(options.fileId)) return false

    const session = readTtsPlaybackSession(options.fileId)
    if (!session?.enabled) return false

    const restoredSession = resolveRestoredTtsSession(session)
    const activeSection = currentSectionIndex()
    if (activeSection === undefined || restoredSession.sectionIndex !== activeSection) return false

    if (restoredSession.wasPlaying) {
      await start(restoredSession.wordIndex, { userInitiated: false })
      const started = await waitForTtsStatus(['speaking', 'loading'])
      if (started) {
        clearPlaybackSession()
        autoResumeAttempted = true
        ttsEnabled.value = true
        return 'resumed'
      }
      writeTtsPlaybackSession(options.fileId, {
        enabled: true,
        wasPlaying: false,
        sectionIndex: restoredSession.sectionIndex,
        wordIndex: restoredSession.wordIndex,
      })
      return false
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const ready = await restoreTtsReadyState(restoredSession)
      if (ready) {
        autoResumeAttempted = true
        ttsEnabled.value = true
        return 'ready'
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return false
  }

  async function tryAutoResumeAfterReload(): Promise<boolean> {
    const result = await restoreTtsAfterReload()
    return result === 'resumed'
  }

  function attachTapToRead(doc: Document) {
    if (tappedDocs.has(doc)) return
    tappedDocs.add(doc)
    doc.addEventListener(
      'click',
      (event) => {
        if (!isActive.value) return
        const currentRoot = root ?? activeRoot()
        if (!currentRoot) return
        if (!words.length) rebuildIndex()
        const wordIndex = findWordIndexAtPoint(currentRoot, words, event.clientX, event.clientY)
        if (wordIndex === null) return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        void start(wordIndex, { userInitiated: true })
      },
      true,
    )
  }

  watch(
    () => [currentSectionIndex(), ttsEnabled.value, status.value] as const,
    ([section, enabled, playbackStatus]) => {
      if (!enabled || section === undefined) return
      if (playbackStatus === 'speaking' || playbackStatus === 'loading') return
      scheduleTtsHighlightRestore()
    },
  )

  watch(
    () => [settings().ttsSentenceHighlightColor, settings().ttsWordHighlightColor],
    () => {
      const doc = options.getDocument()
      if (doc) injectTtsHighlightStyles(doc, settings().ttsSentenceHighlightColor, settings().ttsWordHighlightColor)
      if (ttsEnabled.value) scheduleTtsHighlightRestore()
    },
  )

  watch(status, () => {
    syncMediaSession()
  })

  registerTtsMediaSessionController({
    getStatus: () => status.value,
    getChapterTitle: () => options.getChapterTitle?.() ?? 'Read aloud',
    getProgress: () => progress.value,
    pause,
    resume,
    stop: () => stop(),
    replay,
    skipBackward,
    skipForward,
  })

  navigator.mediaDevices?.addEventListener('devicechange', onAudioOutputChanged)

  const onPageHide = () => persistTtsSessionOnExit()
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') persistTtsSessionOnExit()
  }

  onMounted(() => {
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    attachFoliateShellScrollListeners()
  })

  onUnmounted(() => {
    cancelScheduledHighlightRestore()
    if (scrollFollowEvalTimer !== null) {
      clearTimeout(scrollFollowEvalTimer)
      scrollFollowEvalTimer = null
    }
    const activeDoc = options.getDocument()
    if (activeDoc) detachScrollFollowListeners(activeDoc)
    foliateShellScrollCleanup?.()
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    navigator.mediaDevices?.removeEventListener('devicechange', onAudioOutputChanged)
    registerTtsMediaSessionController(null)
    persistTtsSessionOnExit()
    playbackGeneration++
    window.speechSynthesis?.cancel()
    suppressTtsMediaSession()
    cleanupRuntime(true)
  })

  return {
    status,
    error,
    activeIndex,
    wordCount,
    progress,
    scrollFollowEnabled,
    resumeScrollFollow,
    evaluateScrollFollow,
    isActive,
    isPlaying,
    currentProvider,
    currentSentenceText,
    start,
    playFromToolbar,
    applyTtsSettingsChange,
    pause,
    resume,
    stop,
    suspend,
    leaveReader,
    persistForNavigation,
    replay,
    restartFromCurrentWord,
    skipBackward,
    skipForward,
    handleDocumentLoad,
    tryAutoResumeAfterReload,
    restoreTtsAfterReload,
    refreshTtsHighlight,
    warmUp,
    prefetchPlaybackAhead,
  }
}
