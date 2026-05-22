import type { EpubReaderSettings, TtsProvider } from '@bookorbit/types'
import type { SentenceInfo } from './word-index'

export interface CachedPreparedAudio {
  sentence: SentenceInfo
  buffer: AudioBuffer
  boundaries?: Array<{ offset: number; audioOffsetSec: number }>
  charStarts?: number[]
}

const MAX_CACHE_ENTRIES = 64

const cache = new Map<string, CachedPreparedAudio>()
const inflight = new Map<string, Promise<CachedPreparedAudio>>()

export function buildPreparedAudioCacheKey(
  provider: TtsProvider,
  settings: EpubReaderSettings,
  sentence: SentenceInfo,
  bookLanguage: string,
): string {
  const voice =
    provider === 'azure'
      ? settings.ttsAzureVoice
      : provider === 'gcp-chirp3'
        ? settings.ttsGcpChirp3Voice
        : provider === 'kokoro'
          ? settings.ttsKokoroVoice
          : provider === 'gpt-4o-mini-tts'
            ? settings.ttsGpt4oMiniVoice
            : provider === 'xai'
              ? settings.ttsXaiVoice
              : settings.ttsVoice

  return [provider, voice, settings.ttsRate, settings.ttsPitch, bookLanguage, sentence.text].join('\0')
}

function evictOldestEntry() {
  const oldest = cache.keys().next().value
  if (oldest) cache.delete(oldest)
}

export function getCachedPreparedAudio(key: string): CachedPreparedAudio | undefined {
  return cache.get(key)
}

export async function getOrCreatePreparedAudio(key: string, factory: () => Promise<CachedPreparedAudio>): Promise<CachedPreparedAudio> {
  const cached = cache.get(key)
  if (cached) return cached

  let pending = inflight.get(key)
  if (!pending) {
    pending = factory()
      .then((prepared) => {
        inflight.delete(key)
        if (cache.size >= MAX_CACHE_ENTRIES) evictOldestEntry()
        cache.set(key, prepared)
        return prepared
      })
      .catch((error) => {
        inflight.delete(key)
        throw error
      })
    inflight.set(key, pending)
  }

  return pending
}

export function clearPreparedAudioCache() {
  cache.clear()
  inflight.clear()
}
