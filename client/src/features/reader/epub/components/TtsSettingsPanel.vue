<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { EpubReaderSettings, TtsProvider } from '@bookorbit/types'
import { useTtsCredentials } from '../tts/credentials'
import { formatTtsCharacterCount } from '../tts/format-character-count'
import { useTtsUsage } from '../tts/tts-usage'
import { CLOUD_TTS_PROVIDERS, ttsProviderLabel } from '../tts/tts-provider-display'
import { AZURE_VOICES, GCP_CHIRP3_VOICES, GPT_4O_MINI_TTS_VOICES, KOKORO_VOICES, XAI_VOICES, regionSupportsAzureHd } from '../tts/voices'

defineProps<{
  settings: EpubReaderSettings
}>()

const emit = defineEmits<{
  close: []
  update: [patch: Partial<EpubReaderSettings>]
}>()

const { credentials, ensureLoaded } = useTtsCredentials()
const { usage, fetchUsage } = useTtsUsage()
const browserVoices = ref<SpeechSynthesisVoice[]>([])

const adminConfigHint = 'Ask an admin to configure API keys in Settings → System → Text-to-Speech.'

function refreshBrowserVoices() {
  browserVoices.value = window.speechSynthesis?.getVoices?.() ?? []
}

function providerUsageLabel(provider: TtsProvider) {
  return formatTtsCharacterCount(usage[provider])
}

function providerConfigured(provider: TtsProvider) {
  if (provider === 'azure') return !!credentials.azureKey
  if (provider === 'gcp-chirp3') return credentials.gcpChirp3Configured
  if (provider === 'xai') return credentials.xaiConfigured
  if (provider === 'gpt-4o-mini-tts') return credentials.kokoroConfigured
  if (provider === 'kokoro') return credentials.kokoroConfigured
  return true
}

function updateNumber<K extends keyof EpubReaderSettings>(key: K, value: string) {
  emit('update', { [key]: Number(value) } as Partial<EpubReaderSettings>)
}

onMounted(() => {
  void ensureLoaded()
  void fetchUsage(true)
  refreshBrowserVoices()
  window.speechSynthesis?.addEventListener('voiceschanged', refreshBrowserVoices)
})

onUnmounted(() => {
  window.speechSynthesis?.removeEventListener('voiceschanged', refreshBrowserVoices)
})
</script>

<template>
  <div class="fixed inset-0 z-[70] bg-black/35 backdrop-blur-[2px]" @click.self="emit('close')">
    <aside
      class="absolute bottom-0 right-0 max-h-[86vh] w-full overflow-y-auto rounded-t-xl border border-border bg-card p-4 shadow-2xl sm:bottom-4 sm:right-4 sm:w-[25rem] sm:rounded-xl"
    >
      <div class="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-foreground">Text-to-Speech</h2>
          <p class="text-xs text-muted-foreground">Engine, voice, playback, and highlighting.</p>
        </div>
        <button class="text-sm text-muted-foreground hover:text-foreground" @click="emit('close')">Close</button>
      </div>

      <div class="space-y-5">
        <div>
          <p class="settings-group-label">Engine</p>
          <div class="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/50 p-1 sm:grid-cols-3 lg:grid-cols-5">
            <button
              v-for="provider in CLOUD_TTS_PROVIDERS"
              :key="provider"
              type="button"
              class="inline-flex h-9 items-center justify-center gap-1 rounded-md px-1 text-xs font-medium transition-colors"
              :class="settings.ttsProvider === provider ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
              @click="emit('update', { ttsProvider: provider })"
            >
              <span>{{ ttsProviderLabel(provider) }}</span>
              <span
                class="rounded-full border border-border/80 bg-muted/80 px-1.5 py-0 text-[10px] font-medium leading-4 text-muted-foreground"
                :title="`${providerUsageLabel(provider)} characters this month`"
              >
                {{ providerUsageLabel(provider) }}
              </span>
            </button>
          </div>
        </div>

        <div v-if="settings.ttsProvider === 'browser'" class="space-y-3">
          <label class="block">
            <span class="settings-label">Device voice</span>
            <select
              class="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              :value="settings.ttsVoice ?? ''"
              @change="emit('update', { ttsVoice: ($event.target as HTMLSelectElement).value || null })"
            >
              <option value="">System default</option>
              <option v-for="voice in browserVoices" :key="voice.name" :value="voice.name">{{ voice.name }}</option>
            </select>
          </label>
        </div>

        <div v-else-if="settings.ttsProvider === 'azure'" class="space-y-3">
          <p v-if="!providerConfigured('azure')" class="text-xs text-amber-600">{{ adminConfigHint }}</p>
          <label class="block">
            <span class="settings-label">Azure voice</span>
            <select
              class="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              :value="settings.ttsAzureVoice"
              @change="emit('update', { ttsAzureVoice: ($event.target as HTMLSelectElement).value })"
            >
              <optgroup label="Neural HD">
                <option v-for="voice in AZURE_VOICES.filter((v) => v.tier === 'Neural HD')" :key="voice.name" :value="voice.name">
                  {{ voice.displayName }} ({{ voice.gender === 'Female' ? 'F' : 'M' }}) - {{ voice.style }}
                </option>
              </optgroup>
              <optgroup label="Neural">
                <option v-for="voice in AZURE_VOICES.filter((v) => v.tier === 'Neural')" :key="voice.name" :value="voice.name">
                  {{ voice.displayName }} ({{ voice.gender === 'Female' ? 'F' : 'M' }}) - {{ voice.style }}
                </option>
              </optgroup>
            </select>
            <span
              v-if="
                credentials.azureRegion &&
                !regionSupportsAzureHd(credentials.azureRegion) &&
                AZURE_VOICES.find((v) => v.name === settings.ttsAzureVoice)?.tier === 'Neural HD'
              "
              class="mt-1 block text-xs text-amber-600"
            >
              The configured Azure region may not support Neural HD voices.
            </span>
          </label>
        </div>

        <div v-else-if="settings.ttsProvider === 'gcp-chirp3'" class="space-y-3">
          <p v-if="!providerConfigured('gcp-chirp3')" class="text-xs text-amber-600">{{ adminConfigHint }}</p>
          <label class="block">
            <span class="settings-label">Google voice</span>
            <select
              class="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              :value="settings.ttsGcpChirp3Voice"
              @change="emit('update', { ttsGcpChirp3Voice: ($event.target as HTMLSelectElement).value })"
            >
              <option v-for="voice in GCP_CHIRP3_VOICES" :key="voice" :value="voice">{{ voice.replace(/^en-US-Chirp3-HD-/, '') }}</option>
            </select>
          </label>
        </div>

        <div v-else-if="settings.ttsProvider === 'xai'" class="space-y-3">
          <p v-if="!providerConfigured('xai')" class="text-xs text-amber-600">{{ adminConfigHint }}</p>
          <label class="block">
            <span class="settings-label">xAI voice</span>
            <select
              class="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              :value="settings.ttsXaiVoice"
              @change="emit('update', { ttsXaiVoice: ($event.target as HTMLSelectElement).value })"
            >
              <option v-for="voice in XAI_VOICES" :key="voice" :value="voice">{{ voice }}</option>
            </select>
          </label>
        </div>

        <div v-else-if="settings.ttsProvider === 'kokoro'" class="space-y-3">
          <p v-if="!providerConfigured('kokoro')" class="text-xs text-amber-600">{{ adminConfigHint }}</p>
          <label class="block">
            <span class="settings-label">Kokoro voice</span>
            <select
              class="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              :value="settings.ttsKokoroVoice"
              @change="emit('update', { ttsKokoroVoice: ($event.target as HTMLSelectElement).value })"
            >
              <option v-for="voice in KOKORO_VOICES" :key="voice" :value="voice">{{ voice }}</option>
            </select>
          </label>
        </div>

        <div v-else-if="settings.ttsProvider === 'gpt-4o-mini-tts'" class="space-y-3">
          <p v-if="!providerConfigured('gpt-4o-mini-tts')" class="text-xs text-amber-600">{{ adminConfigHint }}</p>
          <label class="block">
            <span class="settings-label">GPT voice</span>
            <select
              class="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              :value="settings.ttsGpt4oMiniVoice"
              @change="emit('update', { ttsGpt4oMiniVoice: ($event.target as HTMLSelectElement).value })"
            >
              <option v-for="voice in GPT_4O_MINI_TTS_VOICES" :key="voice" :value="voice">{{ voice }}</option>
            </select>
          </label>
        </div>

        <div class="space-y-3">
          <p class="settings-group-label">Playback</p>
          <label class="block">
            <span class="settings-label">Rate {{ settings.ttsRate.toFixed(1) }}x</span>
            <input
              class="mt-2 w-full accent-primary"
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              :value="settings.ttsRate"
              @input="updateNumber('ttsRate', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label v-if="settings.ttsProvider === 'browser'" class="block">
            <span class="settings-label">Pitch {{ settings.ttsPitch.toFixed(1) }}</span>
            <input
              class="mt-2 w-full accent-primary"
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              :value="settings.ttsPitch"
              @input="updateNumber('ttsPitch', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="block">
            <span class="settings-label">Volume {{ Math.round(settings.ttsVolume * 100) }}%</span>
            <input
              class="mt-2 w-full accent-primary"
              type="range"
              min="0"
              max="1"
              step="0.05"
              :value="settings.ttsVolume"
              @input="updateNumber('ttsVolume', ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>

        <div class="space-y-3">
          <p class="settings-group-label">Highlighting</p>
          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="settings-label">Sentence</span>
              <input
                class="mt-2 h-9 w-full rounded-md border border-border bg-background"
                type="color"
                :value="settings.ttsSentenceHighlightColor"
                @input="emit('update', { ttsSentenceHighlightColor: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label class="block">
              <span class="settings-label">Word</span>
              <input
                class="mt-2 h-9 w-full rounded-md border border-border bg-background"
                type="color"
                :value="settings.ttsWordHighlightColor"
                @input="emit('update', { ttsWordHighlightColor: ($event.target as HTMLInputElement).value })"
              />
            </label>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>
