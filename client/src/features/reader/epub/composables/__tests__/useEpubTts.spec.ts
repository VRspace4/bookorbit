import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    setMetadata: vi.fn(async () => undefined),
    setPlaybackState: vi.fn(async () => undefined),
    setActionHandler: vi.fn(async () => undefined),
    setPositionState: vi.fn(async () => undefined),
  },
}))

const azureMocks = vi.hoisted(() => ({
  speakSsmlAsync: vi.fn<(ssml: string) => void>(),
}))

vi.mock('microsoft-cognitiveservices-speech-sdk', () => {
  const ResultReason = { SynthesizingAudioCompleted: 'SynthesizingAudioCompleted' }
  const SpeechSynthesisBoundaryType = { Word: 'Word' }

  class SpeechSynthesizer {
    wordBoundary: ((sender: unknown, event: { boundaryType: string; textOffset: number; audioOffset: number }) => void) | null = null
    close = vi.fn<() => void>()

    speakSsmlAsync(ssml: string, onSuccess: (result: { reason: string; audioData: ArrayBuffer }) => void) {
      azureMocks.speakSsmlAsync(ssml)
      this.wordBoundary?.(this, {
        boundaryType: SpeechSynthesisBoundaryType.Word,
        textOffset: 150,
        audioOffset: 0,
      })
      onSuccess({ reason: ResultReason.SynthesizingAudioCompleted, audioData: new ArrayBuffer(8) })
    }
  }

  return {
    SpeechConfig: { fromSubscription: vi.fn<() => { speechSynthesisVoiceName?: string; speechSynthesisOutputFormat?: string }>(() => ({})) },
    SpeechSynthesizer,
    ResultReason,
    SpeechSynthesisBoundaryType,
    SpeechSynthesisOutputFormat: { Audio24Khz48KBitRateMonoMp3: 'Audio24Khz48KBitRateMonoMp3' },
    CancellationDetails: { fromResult: vi.fn<() => { errorDetails: string }>(() => ({ errorDetails: 'Azure synthesis failed' })) },
  }
})

import { api } from '@/lib/api'
import { useEpubTts } from '../useEpubTts'
import { useTtsCredentials } from '../../tts/credentials'
import { writeTtsPlaybackSession, readTtsPlaybackSession } from '../../tts/tts-session-cache'

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
  connect = vi.fn((target?: unknown) => target ?? {}) as ReturnType<typeof vi.fn>
  disconnect = vi.fn<() => void>()
}

class FakeBufferSourceNode {
  buffer: AudioBuffer | null = null
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
  return vi.mocked(api).mock.calls.map(([, init]) => {
    const body = typeof init?.body === 'string' ? init.body : '{}'
    return (JSON.parse(body) as { text?: string }).text
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
    azureMocks.speakSsmlAsync.mockClear()
    FakeAudioContext.sources = []
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance)
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn<() => number>(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn<() => void>())
    vi.stubGlobal('Audio', function (this: HTMLAudioElement, src?: string) {
      const audio = document.createElement('audio')
      if (src) audio.src = src
      audio.play = vi.fn(async () => undefined) as typeof audio.play
      audio.pause = vi.fn() as typeof audio.pause
      Object.defineProperty(audio, 'paused', { configurable: true, value: true })
      return audio
    } as unknown as typeof Audio)
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
      expect(api).toHaveBeenCalledTimes(2)
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
      expect(api).toHaveBeenCalledTimes(5)
    })

    FakeAudioContext.sources[0]?.onended?.()
    await vi.waitFor(() => {
      expect(FakeAudioContext.sources).toHaveLength(2)
      expect(api).toHaveBeenCalledTimes(6)
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
      expect(FakeAudioContext.sources).toHaveLength(1)
      expect(azureMocks.speakSsmlAsync).toHaveBeenCalledTimes(5)
    })

    FakeAudioContext.sources[0]?.onended?.()
    await vi.waitFor(() => {
      expect(FakeAudioContext.sources).toHaveLength(2)
      expect(azureMocks.speakSsmlAsync).toHaveBeenCalledTimes(6)
    })

    for (let i = 1; i < 5; i++) {
      FakeAudioContext.sources[i]?.onended?.()
      await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(i + 2))
    }
    FakeAudioContext.sources[5]?.onended?.()
    await playback

    expect(tts.status.value).toBe('done')
  })

  it('queues device TTS utterances up front instead of submitting them sentence by sentence', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is first. This is second. This is third.</p>'
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: () => ({ ...makeSettings(), ttsProvider: 'browser', ttsRate: 2 }),
      bookLanguage: ref('en'),
    })

    const playback = tts.start(0)

    await vi.waitFor(() => expect(speechSynthesisMock.speak).toHaveBeenCalledTimes(3))
    expect(speechSynthesisMock.utterances.map((utterance) => utterance.text)).toEqual(['This is first.', 'This is second.', 'This is third.'])

    for (const utterance of speechSynthesisMock.utterances) {
      utterance.onstart?.()
      utterance.onend?.()
    }
    await playback

    expect(tts.status.value).toBe('done')
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

  it('starts reading from a tapped word while TTS mode is active', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    Object.defineProperty(doc, 'caretRangeFromPoint', {
      configurable: true,
      value: vi.fn<() => Range | null>(makeCaretRangeAtTextOffset(doc, 'This is the '.length)),
    })
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en') })
    tts.handleDocumentLoad(doc)

    void tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    vi.mocked(api).mockClear()

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    doc.body.dispatchEvent(click)

    await vi.waitFor(() => expect(apiTexts()).toEqual(['first sentence.']))
    expect(click.defaultPrevented).toBe(true)
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

    await vi.waitFor(() => {
      expect(FakeAudioContext.sources).toHaveLength(2)
      expect(api).toHaveBeenCalledWith('/api/v1/tts/kokoro', expect.any(Object))
    })

    expect(FakeAudioContext.sources[0]?.stop).toHaveBeenCalled()
    expect(tts.currentProvider.value).toBe('kokoro')
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

  it('auto-resumes playback after reload when a session was active', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    writeTtsPlaybackSession(1, { wasPlaying: true, sectionIndex: 0, wordIndex: 3 })
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), getCurrentSectionIndex: () => 0 })

    const resumed = await tts.tryAutoResumeAfterReload()
    expect(resumed).toBe(true)
    await vi.waitFor(() => expect(FakeAudioContext.sources.length).toBeGreaterThan(0))
  })

  it('does not auto-resume after the user stops playback', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    const tts = useEpubTts({ fileId: 1, getDocument: () => doc, getSettings: makeSettings, bookLanguage: ref('en'), getCurrentSectionIndex: () => 0 })

    void tts.start(0)
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    tts.stop()

    writeTtsPlaybackSession(1, { wasPlaying: true, sectionIndex: 0, wordIndex: 3 })
    const resumed = await tts.tryAutoResumeAfterReload()
    expect(resumed).toBe(false)
    expect(readTtsPlaybackSession(1)?.wasPlaying).toBe(true)
    expect(FakeAudioContext.sources).toHaveLength(1)
  })

  it('does not restart playback when auto-resume begins before the user stops', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence. This is the second sentence.</p>'
    writeTtsPlaybackSession(1, { wasPlaying: true, sectionIndex: 0, wordIndex: 3 })
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

  it('cancels browser speech when audio output changes after stop', async () => {
    const doc = document.implementation.createHTMLDocument('Book')
    doc.body.innerHTML = '<p>This is the first sentence.</p>'
    const tts = useEpubTts({
      fileId: 1,
      getDocument: () => doc,
      getSettings: () => ({ ...makeSettings(), ttsProvider: 'browser' }),
      bookLanguage: ref('en'),
      getCurrentSectionIndex: () => 0,
    })

    void tts.start(0)
    await vi.waitFor(() => expect(speechSynthesisMock.speak).toHaveBeenCalled())
    tts.stop()
    speechSynthesisMock.cancel.mockClear()

    navigator.mediaDevices?.dispatchEvent(new Event('devicechange'))

    expect(speechSynthesisMock.cancel).toHaveBeenCalled()
    expect(tts.status.value).toBe('idle')
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
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(1))
    FakeAudioContext.sources[0]?.onended?.()
    await vi.waitFor(() => expect(FakeAudioContext.sources).toHaveLength(2))

    const callsBeforeSkip = azureMocks.speakSsmlAsync.mock.calls.length
    tts.skipForward()
    await vi.waitFor(() => expect(FakeAudioContext.sources.length).toBeGreaterThan(2))
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
