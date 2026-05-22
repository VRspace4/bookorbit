import { reactive, ref } from 'vue'
import { api } from '@/lib/api'
import { AZURE_TTS_DEFAULT_REGION, type TtsRuntimeConfig } from '@bookorbit/types'

export interface TtsCredentials {
  azureKey: string
  azureRegion: string
  gcpChirp3Configured: boolean
  xaiConfigured: boolean
  kokoroConfigured: boolean
}

const EMPTY: TtsCredentials = {
  azureKey: '',
  azureRegion: AZURE_TTS_DEFAULT_REGION,
  gcpChirp3Configured: false,
  xaiConfigured: false,
  kokoroConfigured: false,
}

const state = reactive<TtsCredentials>({ ...EMPTY })
const loaded = ref(false)
let inflight: Promise<void> | null = null

function applyRuntimeConfig(config: TtsRuntimeConfig) {
  state.azureKey = config.azure.apiKey ?? ''
  state.azureRegion = config.azure.region ?? AZURE_TTS_DEFAULT_REGION
  state.gcpChirp3Configured = config.gcpChirp3.configured
  state.xaiConfigured = config.xai.configured
  state.kokoroConfigured = config.kokoro.configured
}

export function useTtsCredentials() {
  async function fetchRuntimeConfig(force = false) {
    if (loaded.value && !force) return
    if (inflight) return inflight

    inflight = (async () => {
      try {
        const res = await api('/api/v1/tts/runtime')
        if (res.ok) {
          applyRuntimeConfig((await res.json()) as TtsRuntimeConfig)
        }
      } catch {
        // ignore network failures; playback will surface a not-configured error for the selected engine
      } finally {
        loaded.value = true
        inflight = null
      }
    })()

    return inflight
  }

  async function ensureLoaded() {
    await fetchRuntimeConfig()
  }

  /** Test helper for injecting runtime config without hitting the API. */
  function updateCredentials(patch: Partial<TtsCredentials>) {
    Object.assign(state, patch)
    loaded.value = true
  }

  return { credentials: state, ensureLoaded, fetchRuntimeConfig, updateCredentials }
}
