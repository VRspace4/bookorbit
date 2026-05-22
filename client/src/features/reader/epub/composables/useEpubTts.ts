import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import type { EpubReaderSettings, TtsProvider } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useTtsCredentials } from '../tts/credentials'
import { AZURE_DEFAULT_VOICE, GCP_CHIRP3_DEFAULT_VOICE, GPT_4O_MINI_TTS_DEFAULT_VOICE, KOKORO_DEFAULT_VOICE, XAI_DEFAULT_VOICE } from '../tts/voices'
import {
  initTtsMediaSession,
  registerTtsMediaSessionController,
  suppressTtsMediaSession,
  syncTtsMediaSession,
  unsuppressTtsMediaSession,
} from '../tts/media-session'
import { buildPreparedAudioCacheKey, getOrCreatePreparedAudio } from '../tts/tts-audio-cache'
import { createTtsOutputChain } from '../tts/tts-audio-output'
import {
  clearTtsPlaybackSession,
  clearTtsUserStopped,
  markTtsUserStopped,
  readTtsPlaybackSession,
  readTtsUserStopped,
  writeTtsPlaybackSession,
} from '../tts/tts-session-cache'
import { useTtsUsage } from '../tts/tts-usage'
import {
  buildWordIndex,
  clearTtsHighlight,
  findFirstVisibleWordIndex,
  findSentenceForWord,
  findWordIndexAtPoint,
  highlightWord,
  injectTtsHighlightStyles,
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
  const currentProvider = ref<TtsProvider | null>(null)
  const currentSentenceText = ref('')

  let root: HTMLElement | null = null
  let words: WordEntry[] = []
  let sentences: SentenceInfo[] = []
  let runtime: SpeechRuntime | null = null
  let missingConfigWarned = false
  let savedWordIndex: number | null = null
  let savedResumeKey: string | null = null
  let loadedDocumentSectionIndex: number | null = null
  let autoResumeAttempted = false
  let userStoppedPlayback = readTtsUserStopped(options.fileId)
  let playbackGeneration = 0
  const tappedDocs = new WeakSet<Document>()

  const isActive = computed(() => status.value !== 'idle')
  const isPlaying = computed(() => status.value === 'speaking' || status.value === 'loading')
  const progress = computed(() => {
    if (wordCount.value <= 0 || activeIndex.value < 0) return 0
    return Math.min(1, (activeIndex.value + 1) / wordCount.value)
  })

  function settings() {
    return options.getSettings()
  }

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

  async function prefetchInitialSentences() {
    await warmUp()
    const provider = resolveProvider(settings().ttsProvider)
    if (provider !== 'azure' || !credentials.azureKey) return
    if (!rebuildIndex() || !sentences.length) return

    const sdk = await getAzureSdk()
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    await ctx.resume().catch(() => {})
    try {
      const prefetchCount = Math.min(AUDIO_PREFETCH_SENTENCE_COUNT + 1, sentences.length)
      await Promise.all(
        sentences
          .slice(0, prefetchCount)
          .map((sentence) => getOrCreatePreparedAudio(preparedAudioCacheKey(sentence, provider), () => synthesizeAzureSentence(sentence, ctx, sdk))),
      )
    } catch {
      // prefetch is best-effort
    } finally {
      await ctx.close().catch(() => {})
    }
  }

  function setActiveWord(index: number) {
    const currentRoot = root ?? activeRoot()
    if (!currentRoot || !words[index]) return
    activeIndex.value = index
    rememberWordIndex(index)
    highlightWord(currentRoot, words, sentences, index)
  }

  function resumeStorageKey(): string | null {
    const key = options.getResumeKey?.()
    return key ? `reader:epub-tts:${key}` : null
  }

  function currentSectionIndex(): number | undefined {
    return options.getCurrentSectionIndex?.()
  }

  function syncPlaybackSession(wasPlaying: boolean, wordIndex = activeIndex.value) {
    const sectionIndex = currentSectionIndex()
    if (sectionIndex === undefined || wordIndex < 0) return
    writeTtsPlaybackSession(options.fileId, {
      wasPlaying,
      sectionIndex,
      wordIndex,
    })
  }

  function rememberWordIndex(index: number) {
    savedWordIndex = index
    savedResumeKey = resumeStorageKey()
    if (savedResumeKey) localStorage.setItem(savedResumeKey, String(index))
    options.onTtsWordIndexChange?.(index)
    if (!userStoppedPlayback && (status.value === 'speaking' || status.value === 'loading' || status.value === 'paused')) {
      syncPlaybackSession(true, index)
    }
  }

  function resetResumeState() {
    savedWordIndex = null
    savedResumeKey = null
  }

  function clearPlaybackSession() {
    clearTtsPlaybackSession(options.fileId)
  }

  function syncMediaSession() {
    syncTtsMediaSession()
  }

  function restoreWordIndex(): number | null {
    const key = resumeStorageKey()
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

    const persisted = options.getPersistedTtsPosition?.()
    const currentSection = options.getCurrentSectionIndex?.()
    if (persisted && currentSection !== undefined && persisted.sectionIndex === currentSection) {
      savedWordIndex = persisted.wordIndex
      savedResumeKey = key ?? null
      if (key) localStorage.setItem(key, String(persisted.wordIndex))
      return savedWordIndex
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

  async function start(fromIndex?: number, startOptions: TtsStartOptions = { userInitiated: true }) {
    if (userStoppedPlayback && !startOptions.userInitiated) return

    if (startOptions.userInitiated) {
      userStoppedPlayback = false
      clearTtsUserStopped(options.fileId)
      autoResumeAttempted = false
      unsuppressTtsMediaSession()
      playbackGeneration++
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
    await ensureLoaded()
    if (playbackRunIsStale(runId)) return
    await warmUp()
    if (!rebuildIndex()) {
      error.value = 'No readable text found in the current section.'
      status.value = 'error'
      return
    }

    const currentRoot = root!
    const restoredIndex = fromIndex ?? restoreWordIndex()
    const startIndex = Math.min(Math.max(0, restoredIndex ?? 0), Math.max(0, words.length - 1))
    const sentence = findSentenceForWord(sentences, startIndex)
    syncPlaybackSession(true, startIndex)
    await playFromSentence(sentence ? startIndex : (restoredIndex ?? startIndex), runId)
    if (playbackRunIsStale(runId)) return
    syncMediaSession()
  }

  async function playFromSentence(wordIndex: number, runId = playbackGeneration) {
    const startSentenceIdx = Math.max(
      0,
      sentences.findIndex((sentence) => wordIndex >= sentence.wordStartIdx && wordIndex < sentence.wordEndIdxExclusive),
    )
    const activeRuntime = DEFAULT_RUNTIME()
    runtime = activeRuntime
    const effectiveProvider = resolveProvider(settings().ttsProvider)
    currentProvider.value = effectiveProvider
    const playbackQueue = buildPlaybackQueue(startSentenceIdx, wordIndex)
    setActiveWord(wordIndex)

    try {
      if (effectiveProvider === 'browser') {
        await playBrowserQueue(playbackQueue, activeRuntime)
      } else if (effectiveProvider === 'azure') {
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
      if (runtime !== activeRuntime || activeRuntime.stopped || activeRuntime.abort.signal.aborted) return
      error.value = err instanceof Error ? err.message : 'TTS playback failed'
      status.value = 'error'
      syncMediaSession()
    }
  }

  async function speakSentence(
    sentence: SentenceInfo,
    activeRuntime: SpeechRuntime,
    effectiveProvider = resolveProvider(settings().ttsProvider),
  ): Promise<void> {
    currentProvider.value = effectiveProvider
    if (effectiveProvider === 'azure') return speakAzureSentence(sentence, activeRuntime)
    if (effectiveProvider === 'xai') return speakCloudAudioSentence(sentence, activeRuntime, fetchXaiAudio)
    if (effectiveProvider === 'gcp-chirp3') return speakCloudAudioSentence(sentence, activeRuntime, fetchGcpAudio)
    if (effectiveProvider === 'kokoro') return speakCloudAudioSentence(sentence, activeRuntime, fetchKokoroAudio)
    if (effectiveProvider === 'gpt-4o-mini-tts') return speakCloudAudioSentence(sentence, activeRuntime, fetchGpt4oMiniTtsAudio)
    return speakBrowserSentence(sentence, activeRuntime)
  }

  function cloudAudioFetcher(provider: TtsProvider): CloudAudioFetcher {
    if (provider === 'gcp-chirp3') return fetchGcpAudio
    if (provider === 'kokoro') return fetchKokoroAudio
    if (provider === 'gpt-4o-mini-tts') return fetchGpt4oMiniTtsAudio
    return fetchXaiAudio
  }

  function resolveProvider(provider: TtsProvider): TtsProvider {
    if (provider === 'azure' && !credentials.azureKey) {
      warnMissingConfig('Azure is not configured. Falling back to the device voice.')
      return 'browser'
    }
    if (provider === 'xai' && !credentials.kokoroConfigured) {
      warnMissingConfig('xAI is not configured. Falling back to the device voice.')
      return 'browser'
    }
    if (provider === 'gcp-chirp3' && !credentials.gcpChirp3Configured) {
      warnMissingConfig('Google Chirp 3 is not configured. Falling back to the device voice.')
      return 'browser'
    }
    if (provider === 'kokoro' && !credentials.kokoroConfigured) {
      warnMissingConfig('Kokoro is not configured. Falling back to the device voice.')
      return 'browser'
    }
    if (provider === 'gpt-4o-mini-tts' && !credentials.kokoroConfigured) {
      warnMissingConfig('GPT is not configured. Falling back to the device voice.')
      return 'browser'
    }
    return provider
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
        if (runtimeIsInactive(activeRuntime) || !preparedAudio) return
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

  function checkpointTtsPosition() {
    if (activeIndex.value >= 0) rememberWordIndex(activeIndex.value)
    options.onTtsCheckpoint?.()
  }

  function pause() {
    if (status.value !== 'speaking' && status.value !== 'loading') return
    if (currentProvider.value === 'browser') window.speechSynthesis.pause()
    runtime?.audioContext?.suspend().catch(() => {})
    status.value = 'paused'
    checkpointTtsPosition()
    syncPlaybackSession(true)
    syncMediaSession()
  }

  function resume() {
    if (userStoppedPlayback || status.value !== 'paused') return
    if (currentProvider.value === 'browser') window.speechSynthesis.resume()
    runtime?.audioContext?.resume().catch(() => {})
    status.value = 'speaking'
    syncPlaybackSession(true)
    syncMediaSession()
  }

  function stop(stopOptions?: { checkpoint?: boolean }) {
    userStoppedPlayback = true
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
    syncPlaybackSession(true, startIndex)
    await playFromSentence(startIndex, runId)
    if (playbackRunIsStale(runId)) return
    syncMediaSession()
  }

  function skipBackward() {
    if (!sentences.length) return
    const target = sentences[Math.max(0, currentSentenceIndex() - 1)]
    if (target) void seekToWord(target.wordStartIdx)
  }

  function skipForward() {
    if (!sentences.length) return
    const target = sentences[Math.min(sentences.length - 1, currentSentenceIndex() + 1)]
    if (target) void seekToWord(target.wordStartIdx)
  }

  function restoreHighlightForActiveWord() {
    if (activeIndex.value < 0) return
    if (!rebuildIndex(true)) return
    setActiveWord(activeIndex.value)
  }

  function handleDocumentLoad(doc: Document) {
    injectTtsHighlightStyles(doc, settings().ttsSentenceHighlightColor, settings().ttsWordHighlightColor)
    attachTapToRead(doc)

    const sectionIndex = currentSectionIndex()
    const isSameSectionReload = sectionIndex !== undefined && sectionIndex === loadedDocumentSectionIndex
    loadedDocumentSectionIndex = sectionIndex ?? null

    if (isSameSectionReload) {
      if (status.value === 'speaking' || status.value === 'loading' || status.value === 'paused') {
        restoreHighlightForActiveWord()
        return
      }
      if (!userStoppedPlayback) void tryAutoResumeAfterReload()
      void prefetchInitialSentences()
      return
    }

    words = []
    sentences = []
    wordCount.value = 0
    warmUpPromise = null

    if (status.value === 'speaking' || status.value === 'loading' || status.value === 'paused') {
      resetResumeState()
      stop({ checkpoint: false })
    }

    if (!userStoppedPlayback) void tryAutoResumeAfterReload()
    void prefetchInitialSentences()
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

  async function tryAutoResumeAfterReload(): Promise<boolean> {
    if (autoResumeAttempted || userStoppedPlayback || readTtsUserStopped(options.fileId)) return false
    const session = readTtsPlaybackSession(options.fileId)
    if (!session?.wasPlaying) return false

    const sectionIndex = currentSectionIndex()
    if (sectionIndex === undefined || session.sectionIndex !== sectionIndex) return false

    autoResumeAttempted = true
    await start(session.wordIndex, { userInitiated: false })

    const started = await waitForTtsStatus(['speaking', 'loading', 'paused'])
    if (started) {
      clearPlaybackSession()
      return true
    }
    return false
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
    () => [settings().ttsSentenceHighlightColor, settings().ttsWordHighlightColor],
    () => {
      const doc = options.getDocument()
      if (doc) injectTtsHighlightStyles(doc, settings().ttsSentenceHighlightColor, settings().ttsWordHighlightColor)
    },
  )

  watch(
    () => [
      settings().ttsProvider,
      settings().ttsVoice,
      settings().ttsRate,
      settings().ttsPitch,
      settings().ttsVolume,
      settings().ttsGcpChirp3Voice,
      settings().ttsAzureVoice,
      settings().ttsXaiVoice,
      settings().ttsKokoroVoice,
      settings().ttsGpt4oMiniVoice,
      credentials.azureKey,
      credentials.azureRegion,
      credentials.gcpChirp3Configured,
      credentials.xaiConfigured,
      credentials.kokoroConfigured,
    ],
    () => {
      if (!isPlaying.value) return
      restartFromCurrentWord()
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

  onUnmounted(() => {
    navigator.mediaDevices?.removeEventListener('devicechange', onAudioOutputChanged)
    registerTtsMediaSessionController(null)
    if (status.value === 'speaking' || status.value === 'loading' || status.value === 'paused') {
      syncPlaybackSession(true)
    }
    checkpointTtsPosition()
    cleanupRuntime(true)
  })

  return {
    status,
    error,
    activeIndex,
    wordCount,
    progress,
    isActive,
    isPlaying,
    currentProvider,
    currentSentenceText,
    start,
    pause,
    resume,
    stop,
    replay,
    restartFromCurrentWord,
    skipBackward,
    skipForward,
    handleDocumentLoad,
    tryAutoResumeAfterReload,
    warmUp,
  }
}
