import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPreparedAudioCache } from '../../tts/tts-audio-cache'
import { ref } from 'vue'
import type { EpubReaderSettings } from '@bookorbit/types'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    warning: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
  },
}))

vi.mock('@jofr/capacitor-media-session', () => ({
  MediaSession: {
    setMetadata: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    setPlaybackState: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    setActionHandler: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    setPositionState: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  },
}))

const azureMocks = vi.hoisted(() => ({
  speakSsmlAsync: vi.fn<(ssml: string) => void>(),
}))

vi.mock('microsoft-cognitiveservices-speech-sdk', () => {
  const ResultReason = { SynthesizingAudioCompleted: 'SynthesizingAudioCompleted' }
  const SpeechSynthesisBoundaryType = { Word: 'Word' }
  const PropertyId = { SpeechServiceResponse_RequestWordBoundary: 'SpeechServiceResponse_RequestWordBoundary' }

  class SpeechSynthesizer {
    wordBoundary: ((sender: unknown, event: { boundaryType: string; text: string; textOffset: number; audioOffset: number }) => void) | null = null
    close = vi.fn<() => void>()

    speakSsmlAsync(ssml: string, onSuccess: (result: { reason: string; audioData: ArrayBuffer }) => void) {
      azureMocks.speakSsmlAsync(ssml)
      // Timed word boundaries (audioOffset is 100-nanosecond units; / 1e7 → seconds).
      const boundaryWords = ['This', 'is', 'the', 'first', 'sentence.']
      boundaryWords.forEach((text, i) => {
        this.wordBoundary?.(this, {
          boundaryType: SpeechSynthesisBoundaryType.Word,
          text,
          textOffset: 150 + i * 4,
          audioOffset: i * 1 * 10_000_000,
        })
      })
      onSuccess({ reason: ResultReason.SynthesizingAudioCompleted, audioData: new ArrayBuffer(8) })
    }
  }

  return {
    SpeechConfig: {
      fromSubscription: vi.fn<
        () => {
          speechSynthesisVoiceName?: string
          speechSynthesisOutputFormat?: string
          setProperty: ReturnType<typeof vi.fn>
        }
      >(() => ({ setProperty: vi.fn<(...args: unknown[]) => void>() })),
    },
    SpeechSynthesizer,
    ResultReason,
    PropertyId,
    SpeechSynthesisBoundaryType,
    SpeechSynthesisOutputFormat: { Audio24Khz48KBitRateMonoMp3: 'Audio24Khz48KBitRateMonoMp3' },
    CancellationDetails: { fromResult: vi.fn<() => { errorDetails: string }>(() => ({ errorDetails: 'Azure synthesis failed' })) },
  }
})

import { api } from '@/lib/api'
import { useEpubTts } from '../useEpubTts'
import { useTtsCredentials } from '../../tts/credentials'
import { TTS_ACTIVE_CLASS, TTS_SENTENCE_CLASS } from '../../tts/word-index'
import { writeTtsPlaybackSession, readTtsPlaybackSession, readTtsUserStopped } from '../../tts/tts-session-cache'

class FakeGainNode {
  gain = { value: 1 }
  connect = vi.fn<(target?: unknown) => FakeGainNode | FakeDynamicsCompressorNode>((target) => (target as FakeGainNode) ?? this)
  disconnect = vi.fn<() => void>()
}

class FakeDynamicsCompressorNode {
  threshold = { value: 0 }
  knee = { value: 0 }
  ratio = { value: 0 }
  attack = { value: 0 }
  release = { value: 0 }
  connect = vi.fn<(target?: unknown) => unknown>((target) => target ?? {})
  disconnect = vi.fn<() => void>()
}

class FakeBufferSourceNode {
  buffer: AudioBuffer | null = null
  playbackRate = { value: 1 }
  onended: (() => void) | null = null
  connect = vi.fn<(gain: FakeGainNode) => FakeGainNode>((gain) => gain)
  disconnect = vi.fn<() => void>()
  start = vi.fn<() => void>()
  stop = vi.fn<() => void>(() => this.onended?.())
}

class FakeAudioBuffer {
  numberOfChannels = 1
  length: number
  sampleRate: number
  duration: number
  private readonly channels: Float32Array[]

  constructor(data = Float32Array.from([0, 0, 0, 0.01, 0.02, 0.01, 0, 0]), sampleRate = 1000) {
    this.channels = [data]
    this.length = data.length
    this.sampleRate = sampleRate
    this.duration = data.length / sampleRate
  }

  getChannelData(channel: number) {
    return this.channels[channel] ?? this.channels[0]!
  }

  copyToChannel(source: Float32Array, channel: number) {
    this.channels[channel]?.set(source)
  }
}

class FakeHtmlAudioElement {
  static instances: FakeHtmlAudioElement[] = []

  src = ''
  volume = 1
  playbackRate = 1
  preload = ''
  currentTime = 0
  duration = 10
  ended = false
  onplaying: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(src?: string) {
    if (src) this.src = src
    FakeHtmlAudioElement.instances.push(this)
  }

  play = vi.fn<() => Promise<void>>(async () => {
    this.paused = false
    this.onplaying?.()
  })

  pause = vi.fn<() => void>(() => {
    this.paused = true
  })

  paused = true
}

class FakeAudioContext {
  static sources: FakeBufferSourceNode[] = []

  currentTime = 0
  destination = {}
  state = 'running'

  resume = vi.fn<() => Promise<void>>(async () => undefined)
  suspend = vi.fn<() => Promise<void>>(async () => undefined)
  close = vi.fn<() => Promise<void>>(async () => undefined)
  decodeAudioData = vi.fn<() => Promise<AudioBuffer>>(async () => new FakeAudioBuffer() as unknown as AudioBuffer)
  createBuffer = vi.fn<(channels: number, length: number, sampleRate: number) => AudioBuffer>(
    (_channels, length, sampleRate) => new FakeAudioBuffer(new Float32Array(length), sampleRate) as unknown as AudioBuffer,
  )
  createGain = vi.fn<() => FakeGainNode>(() => new FakeGainNode())
  createDynamicsCompressor = vi.fn<() => FakeDynamicsCompressorNode>(() => new FakeDynamicsCompressorNode())
  createBufferSource = vi.fn<() => FakeBufferSourceNode>(() => {
    const source = new FakeBufferSourceNode()
    FakeAudioContext.sources.push(source)
    return source
  })
}

class FakeSpeechSynthesisUtterance {
  voice: SpeechSynthesisVoice | null = null
  rate = 1
  pitch = 1
  volume = 1
  onstart: (() => void) | null = null
  onboundary: ((event: { charIndex: number }) => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  onend: (() => void) | null = null

  constructor(readonly text: string) {}
}

function makeSpeechSynthesisMock() {
  const utterances: FakeSpeechSynthesisUtterance[] = []
  return {
    utterances,
    cancel: vi.fn<() => void>(),
    pause: vi.fn<() => void>(),
    resume: vi.fn<() => void>(),
    getVoices: vi.fn<() => SpeechSynthesisVoice[]>(() => []),
    speak: vi.fn<(utterance: FakeSpeechSynthesisUtterance) => void>((utterance) => {
      utterances.push(utterance)
    }),
  }
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function endFakeHtmlAudio(index: number) {
  const audio = FakeHtmlAudioElement.instances[index]
  if (!audio) return
  audio.ended = true
  audio.onended?.()
}

function makeSettings(): EpubReaderSettings {
  return {
    ttsProvider: 'xai',
    ttsXaiVoice: 'orpheus-2',
    ttsKokoroVoice: 'af_bella',
    ttsSentenceHighlightColor: '#fde68a',
    ttsWordHighlightColor: '#f59e0b',
    ttsRate: 1,
    ttsPitch: 1,
    ttsVolume: 1,
  } as EpubReaderSettings
}

function apiTexts() {
  return vi
    .mocked(api)
    .mock.calls.map(([, init]) => {
      const body = typeof init?.body === 'string' ? init.body : '{}'
      try {
        return (JSON.parse(body) as { text?: string }).text
      } catch {
        return undefined
      }
    })
    .filter((text): text is string => typeof text === 'string')
}

function speechApiCalls() {
  return vi.mocked(api).mock.calls.filter(([input, init]) => {
    const url = String(input)
    if (!url.includes('/api/v1/tts/')) return false
    if (url.includes('/usage') || url.includes('/runtime')) return false
    const body = typeof init?.body === 'string' ? init.body : ''
    return body.includes('"text"')
  })
}

function makeCaretRangeAtTextOffset(doc: Document, textOffset: number) {
  return () => {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    let cursor = 0
    let node = walker.nextNode() as Text | null
    while (node) {
      const nextCursor = cursor + node.data.length
      if (textOffset <= nextCursor) {
        const range = doc.createRange()
        range.setStart(node, Math.max(0, textOffset - cursor))
        range.collapse(true)
        return range
      }
      cursor = nextCursor
      node = walker.nextNode() as Text | null
    }
    return null
  }
}

describe('useEpubTts cloud playback', () => {
  let speechSynthesisMock: ReturnType<typeof makeSpeechSynthesisMock>

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    clearPreparedAudioCache()
    azureMocks.speakSsmlAsync.mockClear()
    FakeAudioContext.sources = []
    FakeHtmlAudioElement.instances = []
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn<() => string>(() => 'blob:fake-audio'),
      revokeObjectURL: vi.fn<() => void>(),
    })
    vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance)
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn<() => number>(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn<() => void>())
    vi.stubGlobal('Audio', FakeHtmlAudioElement as unknown as typeof Audio)
    speechSynthesisMock = makeSpeechSynthesisMock()
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: speechSynthesisMock,
    })
    vi.mocked(api).mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn<() => Promise<ArrayBuffer>>(async () => new ArrayBuffer(8)),
    } as unknown as Response)
    useTtsCredentials().updateCredentials({
      azureKey: 'test-azure-key',
      azureRegion: 'eastus',
      xaiConfigured: true,
      kokoroConfigured: true,
    })
  })

  it('prefetches the next xAI sentence before the current sentence ends', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en') })

    const playback = tts.start(0)

    await vi.waitFor(() => {
      expect(FakeAudioContext.sources).toHaveLength(1)
      expect(speechApiCalls()).toHaveLength(2)
    })

    FakeAudioContext.sources[0]?.onended?.()
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(2))
    FakeAudioContext.sources[1]?.onended?.()
    await playback
    await flushMicrotasks()

    expect(tts.status.value).toBe('done')
  })

  it('keeps several cloud sentences prefetched for high-speed playback', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is first. This is second. This is third. This is fourth. This is fifth. This is sixth.</p>'
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: () => ({ ...makeSettings(), ttsRate: 2 }), bookLanguage: ref('en') })

    const playback = tts.start(0)

    await vi.waitFor(() => {
      expect(FakeAudioContext.sources).toHaveLength(1)
      expect(speechApiCalls()).toHaveLength(5)
    })

    FakeAudioContext.sources[0]?.onended?.()
    await vi.waitFor(() => {
      expect(FakeAudioContext.sources).toHaveLength(2)
      expect(speechApiCalls()).toHaveLength(6)
    })

    for (let i = 1; i < 5; i++) {
      FakeAudioContext.sources[i]?.onended?.()
      await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(i + 2))
    }
    FakeAudioContext.sources[5]?.onended?.()
    await playback
    await flushMicrotasks()

    expect(tts.status.value).toBe('done')
  })

  it('prefetches Azure audio with the shared audio queue', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is first. This is second. This is third. This is fourth. This is fifth. This is sixth.</p>'
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: () => ({
        ...makeSettings(),
        ttsProvider: 'azure',
        ttsAzureVoice: 'en-US-JennyNeural',
        ttsRate: 2,
      }),
      bookLanguage: ref('en'),
    })

    const playback = tts.start(0)

    await vi.waitFor(() => {
      expect(FakeHtmlAudioElement.instances).toHaveLength(1)
      expect(azureMocks.speakSsmlAsync).toHaveBeenCalledTimes(5)
    })

    endFakeHtmlAudio(0)
    await vi.waitFor(() => {
      expect(FakeHtmlAudioElement.instances).toHaveLength(2)
      expect(azureMocks.speakSsmlAsync).toHaveBeenCalledTimes(6)
    })

    for (let i = 1; i < 5; i++) {
      endFakeHtmlAudio(i)
      await vi.waitFor(() => expect(FakeHtmlAudioElement.instances).toHaveLength(i + 2))
    }
    endFakeHtmlAudio(5)
    await playback

    expect(tts.status.value).toBe('done')
  })

  it('does not fall back to device TTS when browser is selected', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is first. This is second. This is third.</p>'
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: () => ({ ...makeSettings(), ttsProvider: 'browser', ttsRate: 2 }),
      bookLanguage: ref('en'),
    })

    void tts.start(0)

    await vi.waitFor(() => expect(tts.status.value).toBe('error'))
    expect(speechSynthesisMock.speak).not.toHaveBeenCalled()
    expect(tts.error.value).toContain('Device text-to-speech is not available')
  })

  it('fails when the selected engine is not configured instead of falling back', async () => {
    useTtsCredentials().updateCredentials({
      azureKey: '',
      gcpChirp3Configured: false,
      xaiConfigured: false,
      kokoroConfigured: false,
    })

    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: () => ({ ...makeSettings(), ttsProvider: 'kokoro' }),
      bookLanguage: ref('en'),
    })

    void tts.start(0)

    await vi.waitFor(() => expect(tts.status.value).toBe('error'))
    expect(api).not.toHaveBeenCalled()
    expect(tts.error.value).toContain('Kokoro is not configured')
  })

  it('prefers persisted backend TTS position over local storage for the same section', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    localStorage.setItem('reader:epub-tts:book-1:0', '0')
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      getResumeKey: () => 'book-1:0',
      getCurrentSectionIndex: () => 0,
      getPersistedTtsPosition: () => ({ sectionIndex: 0, wordIndex: 5 }),
    })

    const playback = tts.start()
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    FakeAudioContext.sources[0]?.onended?.()
    await playback

    expect(apiTexts()).toEqual(['This is the second sentence.'])
  })

  it('resumes from persisted backend TTS position when local storage is empty', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      getResumeKey: () => 'book-1:section-1',
      getCurrentSectionIndex: () => 1,
      getPersistedTtsPosition: () => ({ sectionIndex: 1, wordIndex: 5 }),
    })

    const playback = tts.start()
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    FakeAudioContext.sources[0]?.onended?.()
    await playback

    expect(apiTexts()).toEqual(['This is the second sentence.'])
  })

  it('resumes from the saved TTS word position when restarted', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      getResumeKey: () => 'book-1:section-1',
    })

    const firstPlayback = tts.start(5)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    FakeAudioContext.sources[0]?.onended?.()
    await firstPlayback
    tts.stop()

    const secondPlayback = tts.start()
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(2))
    FakeAudioContext.sources[1]?.onended?.()
    await secondPlayback

    expect(apiTexts()).toEqual(['This is the second sentence.', 'This is the second sentence.'])
  })

  it('enables TTS without playing, then starts from a sentence start on demand', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en') })
    tts.handleDocumentLoad(doc)

    // Away-from-last-page flow: chrome only, no audio.
    tts.prepareUi()
    expect(tts.isActive.value).toBe(true)
    expect(tts.status.value).toBe('idle')

    await flushMicrotasks()
    FakeAudioContext.sources = []

    // Word 5 is the start of the second sentence (same path as tap → sentence start).
    const playback = tts.start(5, { userInitiated: true, preserveViewport: true })
    await vi.waitFor(() => expect(FakeAudioContext.sources.length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(tts.currentSentenceText.value).toBe('This is the second sentence.'))
    FakeAudioContext.sources[FakeAudioContext.sources.length - 1]?.onended?.()
    await playback
  })

  it('anchors Foliate to the first visible word before TTS chrome reflow', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>Alpha Bravo Charlie Delta Echo</p>'
    const scrollToAnchor = vi.fn<(anchor: Range | Element, select?: boolean) => Promise<void>>(async () => {})
    const scrollBy = vi.fn<(dx: number, dy: number) => void>()
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      getFoliateRenderer: () => ({
        scrolled: false,
        size: 200,
        start: 300,
        scrollToAnchor,
        scrollBy,
      }),
    })
    tts.handleDocumentLoad(doc)

    // start=300, size=200 → visible content [100, 300]. Only Charlie/Delta are on-page.
    // Charlie at left=120 → lead delta = 120 - (300-200) = 20 after page-snap.
    const rects: DOMRect[] = [
      { top: 20, bottom: 40, left: 20, right: 70, width: 50, height: 20, x: 20, y: 20, toJSON: () => ({}) } as DOMRect,
      { top: 20, bottom: 40, left: 40, right: 90, width: 50, height: 20, x: 40, y: 20, toJSON: () => ({}) } as DOMRect,
      { top: 20, bottom: 40, left: 120, right: 180, width: 60, height: 20, x: 120, y: 20, toJSON: () => ({}) } as DOMRect,
      { top: 20, bottom: 40, left: 200, right: 260, width: 60, height: 20, x: 200, y: 20, toJSON: () => ({}) } as DOMRect,
      { top: 20, bottom: 40, left: 320, right: 380, width: 60, height: 20, x: 320, y: 20, toJSON: () => ({}) } as DOMRect,
    ]
    let call = 0
    const original = Range.prototype.getBoundingClientRect
    Range.prototype.getBoundingClientRect = function () {
      return rects[Math.min(call++, rects.length - 1)]!
    }

    try {
      const wordIndex = await tts.anchorViewportToFirstVisibleWord()
      expect(wordIndex).toBe(2)
      expect(scrollToAnchor).toHaveBeenCalledTimes(1)
      const anchor = scrollToAnchor.mock.calls[0]?.[0]
      expect(anchor).toBeInstanceOf(Range)
      expect((anchor as Range).toString()).toBe('Charlie')
      // Paginated fine-tune nudges the word to the page lead (not just on-page).
      await vi.waitFor(() => expect(scrollBy).toHaveBeenCalled())
      expect(scrollBy.mock.calls[0]?.[0]).toBeGreaterThan(0)

      // Re-apply after chrome reflow uses a fresh range for the same word.
      call = 0
      scrollBy.mockClear()
      await tts.anchorViewportToWord(2)
      expect(scrollToAnchor).toHaveBeenCalledTimes(2)
      expect(String(scrollToAnchor.mock.calls[1]?.[0])).toBe('Charlie')
    } finally {
      if (original) {
        Range.prototype.getBoundingClientRect = original
      } else {
        delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect
      }
    }
  })

  it('starts from the sentence containing a tapped word while TTS mode is active', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const originalGetClientRects = Range.prototype.getClientRects
    Range.prototype.getClientRects = function () {
      return [] as unknown as DOMRectList
    }
    Object.defineProperty(doc, 'caretRangeFromPoint', {
      configurable: true,
      value: vi.fn<() => Range | null>(makeCaretRangeAtTextOffset(doc, 'This is the first sentence. This is the second'.length - 2)),
    })
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en') })
    tts.handleDocumentLoad(doc)
    tts.prepareUi()
    await flushMicrotasks()
    FakeAudioContext.sources = []

    try {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      doc.body.dispatchEvent(click)

      await vi.waitFor(() => expect(tts.currentSentenceText.value).toBe('This is the second sentence.'))
      expect(click.defaultPrevented).toBe(true)
    } finally {
      Range.prototype.getClientRects = originalGetClientRects
    }
  })

  it('sends Kokoro playback through the OpenRouter proxy', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: () => ({ ...makeSettings(), ttsProvider: 'kokoro', ttsRate: 1.4 }),
      bookLanguage: ref('en'),
    })

    const playback = tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    FakeAudioContext.sources[0]?.onended?.()
    await playback

    expect(api).toHaveBeenCalledWith(
      '/api/v1/tts/kokoro',
      expect.objectContaining({
        body: JSON.stringify({
          voice: 'af_bella',
          text: 'This is the first sentence.',
          speed: 1.4,
        }),
      }),
    )
  })

  it('clamps xAI synthesis speed and applies residual playbackRate', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: () => ({ ...makeSettings(), ttsProvider: 'xai', ttsRate: 2 }),
      bookLanguage: ref('en'),
    })

    const playback = tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    expect(FakeAudioContext.sources[0]?.playbackRate.value).toBeCloseTo(2 / 1.5, 5)
    FakeAudioContext.sources[0]?.onended?.()
    await playback

    expect(api).toHaveBeenCalledWith(
      '/api/v1/tts/xai',
      expect.objectContaining({
        body: JSON.stringify({
          voice: 'orpheus-2',
          text: 'This is the first sentence.',
          language: 'en',
          speed: 1.5,
        }),
      }),
    )
  })

  it('prefetches Kokoro audio when the section document loads', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: () => ({ ...makeSettings(), ttsProvider: 'kokoro' }),
      bookLanguage: ref('en'),
    })

    tts.handleDocumentLoad(doc)
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/v1/tts/kokoro', expect.any(Object)))

    vi.mocked(api).mockClear()
    const playback = tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    FakeAudioContext.sources[0]?.onended?.()
    await playback

    expect(api).not.toHaveBeenCalled()
  })

  it('restarts active playback with the newly selected engine', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    const settingsRef = ref(makeSettings())
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: () => settingsRef.value, bookLanguage: ref('en') })

    void tts.start(0)
    await vi.waitFor(() => {
      expect(FakeAudioContext.sources).toHaveLength(1)
      expect(api).toHaveBeenCalledWith('/api/v1/tts/xai', expect.any(Object))
    })

    settingsRef.value = { ...settingsRef.value, ttsProvider: 'kokoro' }
    tts.applyTtsSettingsChange()

    await vi.waitFor(() => {
      expect(FakeAudioContext.sources).toHaveLength(2)
      expect(api).toHaveBeenCalledWith('/api/v1/tts/kokoro', expect.any(Object))
    })

    expect(FakeAudioContext.sources[0]?.stop).toHaveBeenCalled()
    expect(tts.currentProvider.value).toBe('kokoro')
  })

  it('restarts idle TTS with saved position when settings change', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    writeTtsPlaybackSession(1, { enabled: true, wasPlaying: false, sectionIndex: 0, wordIndex: 0 })
    const settingsRef = ref(makeSettings())
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: () => settingsRef.value,
      bookLanguage: ref('en'),
      getCurrentSectionIndex: () => 0,
    })

    tts.handleDocumentLoad(doc)
    await tts.restoreTtsAfterReload()
    expect(tts.status.value).toBe('idle')

    vi.mocked(api).mockClear()
    settingsRef.value = { ...settingsRef.value, ttsProvider: 'kokoro' }
    tts.applyTtsSettingsChange()

    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/v1/tts/kokoro', expect.any(Object)))
    expect(tts.currentProvider.value).toBe('kokoro')
  })

  it('restarts immediately when settings change while paused', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    const settingsRef = ref(makeSettings())
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: () => settingsRef.value, bookLanguage: ref('en') })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    tts.pause()

    vi.mocked(api).mockClear()
    settingsRef.value = { ...settingsRef.value, ttsProvider: 'kokoro' }
    tts.applyTtsSettingsChange()

    await vi.waitFor(() => {
      expect(api).toHaveBeenCalledWith('/api/v1/tts/kokoro', expect.any(Object))
      expect(FakeAudioContext.sources.length).toBeGreaterThanOrEqual(2)
    })
    expect(FakeAudioContext.sources[0]?.stop).toHaveBeenCalled()
    expect(tts.currentProvider.value).toBe('kokoro')
  })

  it('restarts immediately when playback rate changes while speaking', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const settingsRef = ref(makeSettings())
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: () => settingsRef.value, bookLanguage: ref('en') })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    const callsBefore = vi.mocked(api).mock.calls.length

    settingsRef.value = { ...settingsRef.value, ttsRate: 1.8 }
    tts.applyTtsSettingsChange()

    await vi.waitFor(() => expect(FakeAudioContext.sources.length).toBeGreaterThanOrEqual(2))
    expect(vi.mocked(api).mock.calls.length).toBeGreaterThan(callsBefore)
    expect(FakeAudioContext.sources[0]?.stop).toHaveBeenCalled()
  })

  it('calls onSectionComplete when playback finishes naturally', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    const onSectionComplete = vi.fn<() => void>()
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), onSectionComplete })

    const playback = tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    FakeAudioContext.sources[0]?.onended?.()
    await playback
    await flushMicrotasks()

    expect(onSectionComplete).toHaveBeenCalledTimes(1)
    expect(tts.status.value).toBe('done')
  })

  it('does not auto-advance section when reload auto-resume finishes residual audio', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    const onSectionComplete = vi.fn<() => void>()
    writeTtsPlaybackSession(1, { enabled: true, wasPlaying: true, sectionIndex: 0, wordIndex: 0 })
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      getCurrentSectionIndex: () => 0,
      onSectionComplete,
    })

    tts.handleDocumentLoad(doc)
    const restorePromise = tts.restoreTtsAfterReload()
    await vi.waitFor(() => expect(FakeAudioContext.sources.length).toBeGreaterThanOrEqual(1))
    FakeAudioContext.sources[FakeAudioContext.sources.length - 1]?.onended?.()
    await restorePromise
    await flushMicrotasks()

    expect(onSectionComplete).not.toHaveBeenCalled()
  })

  it('restores highlight after reload without scrolling the reader', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    // jsdom Range lacks layout metrics used by follow-visibility checks.
    const originalRangeRect = Range.prototype.getBoundingClientRect
    Range.prototype.getBoundingClientRect = function () {
      return { top: 10, bottom: 24, left: 10, right: 50, width: 40, height: 14, x: 10, y: 10, toJSON: () => ({}) } as DOMRect
    }
    writeTtsPlaybackSession(1, { enabled: true, wasPlaying: false, sectionIndex: 0, wordIndex: 3 })
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      getCurrentSectionIndex: () => 0,
      getPersistedTtsPosition: () => ({ sectionIndex: 0, wordIndex: 3 }),
    })

    try {
      tts.handleDocumentLoad(doc)
      const result = await tts.restoreTtsAfterReload()
      expect(result).toBe('ready')
      expect(tts.activeIndex.value).toBeGreaterThanOrEqual(0)
      expect(doc.querySelector(`.${TTS_ACTIVE_CLASS}`)).toBeTruthy()
    } finally {
      Range.prototype.getBoundingClientRect = originalRangeRect
    }
  })

  it('checkpoints pause at the first word of the current sentence', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const onTtsWordIndexChange = vi.fn<(wordIndex: number) => void>()
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      onTtsWordIndexChange,
    })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    onTtsWordIndexChange.mockClear()
    FakeAudioContext.sources[0]?.onended?.()
    await vi.waitFor(() => expect(FakeAudioContext.sources.length).toBeGreaterThanOrEqual(2))

    onTtsWordIndexChange.mockClear()
    tts.pause()

    expect(onTtsWordIndexChange).toHaveBeenCalledTimes(1)
    expect(onTtsWordIndexChange).toHaveBeenCalledWith(5)
    expect(readTtsPlaybackSession(1)?.wordIndex).toBe(5)
  })

  it('checkpoints skip forward at the first word of the target sentence', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const onTtsWordIndexChange = vi.fn<(wordIndex: number) => void>()
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      onTtsWordIndexChange,
    })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    onTtsWordIndexChange.mockClear()

    tts.skipForward()
    await vi.waitFor(() => expect(onTtsWordIndexChange).toHaveBeenCalled())

    expect(onTtsWordIndexChange).toHaveBeenLastCalledWith(5)
    expect(readTtsPlaybackSession(1)?.wordIndex).toBe(5)
  })

  it('checkpoints skip backward at the first word of the target sentence', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const onTtsWordIndexChange = vi.fn<(wordIndex: number) => void>()
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      onTtsWordIndexChange,
    })

    void tts.start(5)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    onTtsWordIndexChange.mockClear()

    tts.skipBackward()
    await vi.waitFor(() => expect(onTtsWordIndexChange).toHaveBeenCalled())

    expect(onTtsWordIndexChange).toHaveBeenLastCalledWith(0)
    expect(readTtsPlaybackSession(1)?.wordIndex).toBe(0)
  })

  it('persists TTS position at sentence boundaries, not on every word', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const onTtsWordIndexChange = vi.fn<(wordIndex: number) => void>()
    const onTtsCheckpoint = vi.fn<() => void>()
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      onTtsWordIndexChange,
      onTtsCheckpoint,
    })

    const playback = tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    expect(onTtsWordIndexChange).toHaveBeenCalledTimes(1)
    expect(onTtsWordIndexChange).toHaveBeenLastCalledWith(0)
    expect(onTtsCheckpoint).toHaveBeenCalledTimes(1)

    onTtsWordIndexChange.mockClear()
    onTtsCheckpoint.mockClear()
    FakeAudioContext.sources[0]?.onended?.()
    await vi.waitFor(() => expect(FakeAudioContext.sources.length).toBeGreaterThanOrEqual(2))
    expect(onTtsWordIndexChange).toHaveBeenCalledTimes(1)
    expect(onTtsWordIndexChange.mock.calls[0]?.[0]).toBeGreaterThan(0)
    expect(onTtsCheckpoint).toHaveBeenCalledTimes(1)

    onTtsWordIndexChange.mockClear()
    onTtsCheckpoint.mockClear()
    FakeAudioContext.sources[1]?.onended?.()
    await playback
    expect(onTtsWordIndexChange).not.toHaveBeenCalled()
    expect(onTtsCheckpoint).not.toHaveBeenCalled()
  })

  it('does not resume from a stale word index after switching sections', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    let sectionIndex = 1
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      getResumeKey: () => `book-1:${sectionIndex}`,
      getCurrentSectionIndex: () => sectionIndex,
    })

    const firstPlayback = tts.start(5)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    FakeAudioContext.sources[0]?.onended?.()
    await firstPlayback
    tts.stop()

    sectionIndex = 2
    vi.mocked(api).mockClear()
    void tts.start()
    await vi.waitFor(() => expect(api).toHaveBeenCalled())
    expect(apiTexts()[0]).toBe('This is the first sentence.')
  })

  it('stops active playback when a new section document loads', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    const onTtsWordIndexChange = vi.fn<(wordIndex: number) => void>()
    let sectionIndex = 1
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      getResumeKey: () => 'book-1:1',
      getCurrentSectionIndex: () => sectionIndex,
      onTtsWordIndexChange,
    })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    onTtsWordIndexChange.mockClear()

    sectionIndex = 2
    const nextDoc = document.implementation.createHTMLDocument('Next')
    nextDoc.body.innerHTML = '<p>Next section text.</p>'
    tts.handleDocumentLoad(nextDoc)

    expect(tts.status.value).toBe('idle')
    expect(onTtsWordIndexChange).not.toHaveBeenCalled()
  })

  it('keeps a paused highlight anchored to its source section after manual section navigation', async () => {
    let sectionIndex = 1
    const sourceDoc = document.implementation.createHTMLDocument('Book')
    sourceDoc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    let doc = sourceDoc
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: makeSettings,
      bookLanguage: ref('en'),
      getResumeKey: () => `book-1:${sectionIndex}`,
      getCurrentSectionIndex: () => sectionIndex,
    })

    void tts.start(5)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    tts.pause()

    expect(tts.followTarget.value).toEqual({ sectionIndex: 1, wordIndex: 5 })
    expect(sourceDoc.body.querySelector(`.${TTS_ACTIVE_CLASS}`)?.textContent).toBe('This')

    sectionIndex = 2
    const nextDoc = document.implementation.createHTMLDocument('Next')
    nextDoc.body.innerHTML = '<p>Other section words should not inherit the paused TTS highlight.</p>'
    doc = nextDoc
    tts.handleDocumentLoad(nextDoc)

    expect(tts.restoreTtsHighlightNow()).toBe(false)
    expect(nextDoc.body.querySelector(`.${TTS_SENTENCE_CLASS}`)).toBeNull()
    expect(nextDoc.body.querySelector(`.${TTS_ACTIVE_CLASS}`)).toBeNull()
    expect(tts.followTarget.value).toEqual({ sectionIndex: 1, wordIndex: 5 })

    sectionIndex = 1
    doc = sourceDoc
    const restored = tts.restoreTtsHighlightNow()

    expect(restored).toBe(true)
    expect(sourceDoc.body.querySelector(`.${TTS_ACTIVE_CLASS}`)?.textContent).toBe('This')
  })

  it('auto-resumes playback after reload when a session was active', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    writeTtsPlaybackSession(1, { enabled: true, wasPlaying: true, sectionIndex: 0, wordIndex: 3 })
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), getCurrentSectionIndex: () => 0 })

    const resumed = await tts.tryAutoResumeAfterReload()
    expect(resumed).toBe(true)
    await vi.waitFor(() => expect(FakeAudioContext.sources.length).toBeGreaterThan(0))
  })

  it('restores enabled TTS in idle state without auto-playing', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    writeTtsPlaybackSession(1, { enabled: true, wasPlaying: false, sectionIndex: 0, wordIndex: 3 })
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), getCurrentSectionIndex: () => 0 })

    const restored = await tts.restoreTtsAfterReload()
    expect(restored).toBe('ready')
    expect(tts.status.value).toBe('idle')
    expect(tts.isActive.value).toBe(true)
    expect(FakeAudioContext.sources).toHaveLength(0)
  })

  it('restores sentence and word highlights after reload when TTS mode is enabled', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    writeTtsPlaybackSession(1, { enabled: true, wasPlaying: false, sectionIndex: 0, wordIndex: 3 })
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), getCurrentSectionIndex: () => 0 })

    tts.handleDocumentLoad(doc)
    await tts.restoreTtsAfterReload()
    tts.refreshTtsHighlight()

    await vi.waitFor(() => {
      expect(doc.body.querySelector(`.${TTS_SENTENCE_CLASS}`)).not.toBeNull()
      expect(doc.body.querySelector(`.${TTS_ACTIVE_CLASS}`)).not.toBeNull()
    })
  })

  it('starts playback when resume is requested without suspended audio', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    writeTtsPlaybackSession(1, { enabled: true, wasPlaying: false, sectionIndex: 0, wordIndex: 0 })
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), getCurrentSectionIndex: () => 0 })

    await tts.restoreTtsAfterReload()
    expect(tts.status.value).toBe('idle')

    tts.resume()
    await vi.waitFor(() => expect(FakeAudioContext.sources.length).toBeGreaterThan(0))
    expect(tts.status.value).toBe('speaking')
  })

  it('persists enabled-but-paused state when playback is paused', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), getCurrentSectionIndex: () => 0 })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    tts.pause()

    expect(readTtsPlaybackSession(1)).toEqual(
      expect.objectContaining({
        enabled: true,
        wasPlaying: false,
      }),
    )
  })

  it('continues word highlighting after pause and resume mid-sentence (HTML audio)', async () => {
    // Controllable RAF: ticks only when we flush, so we can assert mid-sentence resume.
    const rafQueue: FrameRequestCallback[] = []
    let rafSeq = 1
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb)
      return rafSeq++
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn<(id: number) => void>())
    const flushRaf = (n = 1) => {
      for (let i = 0; i < n; i++) {
        const cb = rafQueue.shift()
        if (!cb) break
        cb(performance.now())
      }
    }

    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: () => ({ ...makeSettings(), ttsProvider: 'azure' }),
      bookLanguage: ref('en'),
      getCurrentSectionIndex: () => 0,
    })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeHtmlAudioElement.instances).toHaveLength(1))
    const audio = FakeHtmlAudioElement.instances[0]!
    audio.currentTime = 0.2
    await vi.waitFor(() => expect(tts.status.value).toBe('speaking'))
    flushRaf(3)
    expect(tts.activeIndex.value).toBe(0)

    tts.pause()
    expect(tts.status.value).toBe('paused')
    expect(audio.pause).toHaveBeenCalled()
    // Drain any pending ticks while paused (highlight must not advance further on its own).
    flushRaf(5)
    const indexWhilePaused = tts.activeIndex.value

    // Advance audio into later words of the same sentence, then resume.
    audio.currentTime = 3.2
    tts.resume()
    await vi.waitFor(() => expect(tts.status.value).toBe('speaking'))
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2))

    // Highlight tracking must re-run after resume (not wait until the next sentence).
    flushRaf(8)
    expect(tts.activeIndex.value).toBeGreaterThan(indexWhilePaused)
  })

  it('persistForNavigation keeps TTS enabled in storage without tearing down playback', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), getCurrentSectionIndex: () => 0 })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    tts.pause()
    tts.persistForNavigation()

    expect(tts.isActive.value).toBe(true)
    expect(tts.status.value).toBe('paused')
    expect(readTtsPlaybackSession(1)).toEqual(
      expect.objectContaining({
        enabled: true,
        wasPlaying: false,
      }),
    )
    expect(readTtsUserStopped(1)).toBe(false)
  })

  it('does not auto-resume after the user stops playback', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), getCurrentSectionIndex: () => 0 })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    tts.stop()

    writeTtsPlaybackSession(1, { enabled: true, wasPlaying: true, sectionIndex: 0, wordIndex: 3 })
    const resumed = await tts.tryAutoResumeAfterReload()
    expect(resumed).toBe(false)
    expect(readTtsPlaybackSession(1)?.wasPlaying).toBe(true)
    expect(FakeAudioContext.sources).toHaveLength(1)
  })

  it('does not restart playback when auto-resume begins before the user stops', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    writeTtsPlaybackSession(1, { enabled: true, wasPlaying: true, sectionIndex: 0, wordIndex: 3 })
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), getCurrentSectionIndex: () => 0 })

    const resumePromise = tts.tryAutoResumeAfterReload()
    tts.stop()
    const resumed = await resumePromise

    expect(resumed).toBe(false)
    expect(tts.status.value).toBe('idle')
    expect(FakeAudioContext.sources).toHaveLength(0)
  })

  it('keeps paused playback suspended when audio output changes', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), getCurrentSectionIndex: () => 0 })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    tts.pause()
    speechSynthesisMock.pause.mockClear()

    navigator.mediaDevices?.dispatchEvent(new Event('devicechange'))

    expect(speechSynthesisMock.pause).not.toHaveBeenCalled()
    expect(tts.status.value).toBe('paused')
  })

  it('reuses cached Azure audio when skipping backward', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is first. This is second. This is third.</p>'
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: () => ({
        ...makeSettings(),
        ttsProvider: 'azure',
        ttsAzureVoice: 'en-US-JennyNeural',
      }),
      bookLanguage: ref('en'),
    })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeHtmlAudioElement.instances).toHaveLength(1))
    endFakeHtmlAudio(0)
    await vi.waitFor(() => expect(FakeHtmlAudioElement.instances).toHaveLength(2))

    const callsBeforeSkip = azureMocks.speakSsmlAsync.mock.calls.length
    tts.skipForward()
    await vi.waitFor(() => expect(FakeHtmlAudioElement.instances.length).toBeGreaterThan(2))
    const callsAfterForward = azureMocks.speakSsmlAsync.mock.calls.length
    expect(callsAfterForward).toBeGreaterThan(callsBeforeSkip)

    tts.skipBackward()
    await vi.waitFor(() => expect(tts.status.value).toBe('speaking'))
    expect(azureMocks.speakSsmlAsync.mock.calls.length).toBe(callsAfterForward)
  })

  it('keeps playback active when the tab is backgrounded', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), getCurrentSectionIndex: () => 0 })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(tts.status.value).toBe('speaking')
  })
})
