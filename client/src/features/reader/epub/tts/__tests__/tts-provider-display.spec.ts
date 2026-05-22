import { describe, expect, it } from 'vitest'
import { resolveCloudTtsProvider, ttsProviderLabel } from '../tts-provider-display'

describe('tts-provider-display', () => {
  it('defaults to Kokoro when runtime and settings are unknown', () => {
    expect(resolveCloudTtsProvider(null, 'browser')).toBe('kokoro')
    expect(ttsProviderLabel('browser')).toBe('Kokoro')
  })

  it('prefers the runtime provider when it is a cloud engine', () => {
    expect(resolveCloudTtsProvider('azure', 'kokoro')).toBe('azure')
  })

  it('uses settings when runtime is unset', () => {
    expect(resolveCloudTtsProvider(null, 'xai')).toBe('xai')
    expect(ttsProviderLabel('xai')).toBe('xAI')
  })
})
