import { describe, expect, it, vi } from 'vitest'
import { buildPreparedAudioCacheKey, clearPreparedAudioCache, getOrCreatePreparedAudio } from '../tts-audio-cache'
import type { EpubReaderSettings } from '@bookorbit/types'

const settings: EpubReaderSettings = {
  ttsProvider: 'azure',
  ttsAzureVoice: 'en-US-JennyNeural',
  ttsRate: 1,
  ttsPitch: 1,
  ttsVolume: 1,
  ttsVoice: '',
  ttsXaiVoice: '',
  ttsGcpChirp3Voice: '',
  ttsKokoroVoice: '',
  ttsGpt4oMiniVoice: '',
  ttsSentenceHighlightColor: '#000000',
  ttsWordHighlightColor: '#000000',
  ttsSkipBackSeconds: 10,
  ttsSkipForwardSeconds: 10,
} as EpubReaderSettings

describe('tts-audio-cache', () => {
  it('deduplicates in-flight synthesis for the same sentence', async () => {
    clearPreparedAudioCache()
    const factory = vi.fn(async () => ({
      sentence: { text: 'Hello world.', wordStartIdx: 0, wordEndIdxExclusive: 2 },
      buffer: {} as AudioBuffer,
    }))
    const key = buildPreparedAudioCacheKey('azure', settings, { text: 'Hello world.', wordStartIdx: 0, wordEndIdxExclusive: 2 }, 'en')

    const [first, second] = await Promise.all([getOrCreatePreparedAudio(key, factory), getOrCreatePreparedAudio(key, factory)])

    expect(factory).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
  })
})
