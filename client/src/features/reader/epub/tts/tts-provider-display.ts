import type { TtsProvider } from '@bookorbit/types'

export const CLOUD_TTS_PROVIDERS = ['azure', 'gcp-chirp3', 'xai', 'kokoro', 'gpt-4o-mini-tts'] as const satisfies readonly TtsProvider[]

export type CloudTtsProvider = (typeof CLOUD_TTS_PROVIDERS)[number]

export function isCloudTtsProvider(provider: TtsProvider): provider is CloudTtsProvider {
  return (CLOUD_TTS_PROVIDERS as readonly TtsProvider[]).includes(provider)
}

/** Pick a cloud engine for display/playback: runtime when known, else settings, else Kokoro. */
export function resolveCloudTtsProvider(runtime: TtsProvider | null | undefined, selected: TtsProvider): CloudTtsProvider {
  if (runtime && isCloudTtsProvider(runtime)) return runtime
  if (isCloudTtsProvider(selected)) return selected
  return 'kokoro'
}

export function ttsProviderLabel(provider: TtsProvider): string {
  if (provider === 'azure') return 'Azure'
  if (provider === 'gcp-chirp3') return 'Google'
  if (provider === 'xai') return 'xAI'
  if (provider === 'kokoro') return 'Kokoro'
  if (provider === 'gpt-4o-mini-tts') return 'GPT'
  return 'Kokoro'
}
