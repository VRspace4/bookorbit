<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loader2, Save } from 'lucide-vue-next'
import type { TtsProviderConfigKey, TtsProviderConfigurations, TtsProviderStatus } from '@bookorbit/types'
import { toast } from 'vue-sonner'
import { Badge } from '@/components/ui/badge'
import { AZURE_REGIONS, regionSupportsAzureHd } from '@/features/reader/epub/tts/voices'

const props = defineProps<{
  config: TtsProviderConfigurations | null
  statuses: TtsProviderStatus[]
  saving: boolean
}>()

const emit = defineEmits<{ save: [patch: Partial<TtsProviderConfigurations>] }>()

const draft = ref<TtsProviderConfigurations | null>(null)

watch(
  () => props.config,
  (c) => {
    if (c) draft.value = JSON.parse(JSON.stringify(c))
  },
  { immediate: true },
)

const rows: {
  key: TtsProviderConfigKey
  label: string
  hint: string
  placeholder: string
}[] = [
  {
    key: 'azure',
    label: 'Azure Speech',
    hint: 'Used by the Azure Speech SDK in the reader. Requires a subscription key from the Azure portal and a speech region.',
    placeholder: '32-character key',
  },
  {
    key: 'gcpChirp3',
    label: 'Google Chirp 3',
    hint: "Google Cloud Text-to-Speech API key. BookOrbit calls Google from the server, so do not use HTTP referrer restrictions—use None or restrict by server IP. Enable the Cloud Text-to-Speech API and allow it in the key's API restrictions.",
    placeholder: 'AIza...',
  },
  {
    key: 'xai',
    label: 'xAI (OpenRouter)',
    hint: 'Uses the OpenRouter API key configured for Kokoro. Enable Kokoro first, then toggle xAI here.',
    placeholder: '',
  },
  {
    key: 'kokoro',
    label: 'Kokoro (OpenRouter)',
    hint: 'OpenRouter API key for Kokoro, xAI, and GPT TTS models.',
    placeholder: 'sk-or-...',
  },
]

function statusFor(key: TtsProviderConfigKey) {
  return props.statuses.find((s) => s.key === key)
}

function save() {
  if (!draft.value) return
  emit('save', draft.value)
}

function canEnableProvider(key: TtsProviderConfigKey): boolean {
  if (!draft.value) return false
  if (key === 'xai') return !!draft.value.kokoro.apiKey.trim()
  return !!draft.value[key].apiKey.trim()
}

function toggleProvider(key: TtsProviderConfigKey) {
  if (!draft.value) return
  const provider = draft.value[key]
  if (!provider.enabled && !canEnableProvider(key)) {
    toast.error(`${rows.find((row) => row.key === key)?.label ?? 'Provider'} requires an API key before it can be enabled`)
    return
  }
  provider.enabled = !provider.enabled
}

function onSecretFieldFocus(event: FocusEvent) {
  const input = event.target as HTMLInputElement | null
  if (input?.readOnly) input.readOnly = false
}
</script>

<template>
  <div class="border border-border rounded-lg bg-card overflow-hidden shadow-xs">
    <div class="px-4 py-3.5 md:px-5 md:py-4 border-b border-border flex items-center justify-between bg-muted/30">
      <div>
        <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">Cloud TTS Providers</span>
        <p class="settings-hint mt-1">API keys configured here apply to all users and devices.</p>
      </div>
      <button class="settings-btn-primary h-8 px-3" :disabled="saving || !draft" @click="save">
        <Loader2 v-if="saving" :size="14" class="animate-spin" />
        <Save v-else :size="14" />
        <span>Save Changes</span>
      </button>
    </div>

    <div v-if="draft" class="divide-y divide-border">
      <div
        v-for="row in rows"
        :key="row.key"
        class="px-4 py-3.5 md:px-5 md:py-4 flex flex-col md:flex-row md:items-start justify-between gap-4 md:gap-6 bg-card transition-colors hover:bg-muted/30"
      >
        <div class="space-y-1 min-w-0">
          <div class="flex items-center gap-3">
            <span class="settings-label">{{ row.label }}</span>
            <template v-if="statusFor(row.key)">
              <Badge v-if="!statusFor(row.key)?.configured" variant="destructive" class="h-4 px-1.5 text-[9px] font-bold uppercase tracking-wide">
                Setup Required
              </Badge>
              <Badge
                v-else
                variant="outline"
                class="h-4 px-1.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600 border-emerald-500/30 bg-emerald-500/5"
              >
                Ready
              </Badge>
            </template>
          </div>
          <p class="settings-hint max-w-sm">{{ row.hint }}</p>
        </div>

        <div class="flex flex-col items-start gap-3 w-full md:ml-auto md:w-auto md:min-w-[18rem]">
          <input
            v-if="row.key !== 'xai'"
            v-model="draft[row.key].apiKey"
            type="text"
            :name="`tts-${row.key}-apiKey`"
            :placeholder="row.placeholder"
            :readonly="true"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            data-lpignore="true"
            data-1p-ignore="true"
            data-form-type="other"
            style="--webkit-text-security: disc"
            class="h-9 w-full sm:w-64 lg:w-80 rounded-md border border-input bg-background px-3 text-xs font-medium placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary transition-all"
            @focus="onSecretFieldFocus"
          />

          <label v-if="row.key === 'azure'" class="block w-full">
            <span class="settings-label">Azure region</span>
            <select
              v-model="draft.azure.region"
              class="mt-2 h-9 w-full sm:w-64 lg:w-80 rounded-md border border-input bg-background px-3 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary transition-all"
            >
              <option v-for="region in AZURE_REGIONS" :key="region.code" :value="region.code">{{ region.label }} ({{ region.code }})</option>
            </select>
            <span v-if="draft.azure.region && !regionSupportsAzureHd(draft.azure.region)" class="mt-1 block text-xs text-amber-600">
              This region may not support Neural HD voices.
            </span>
          </label>

          <div
            class="flex items-center justify-between w-full md:justify-end gap-3 rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 md:border-none md:bg-transparent md:px-0 md:py-0"
          >
            <span class="text-xs text-muted-foreground md:hidden">Enabled</span>
            <button
              type="button"
              role="switch"
              :aria-checked="draft[row.key].enabled"
              class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none"
              :class="draft[row.key].enabled ? 'bg-primary' : 'bg-muted border border-border'"
              @click="toggleProvider(row.key)"
            >
              <span
                class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform"
                :class="draft[row.key].enabled ? 'translate-x-4.5' : 'translate-x-0.5'"
              />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="px-6 py-12 flex items-center justify-center">
      <Loader2 :size="24" class="animate-spin text-muted-foreground" />
    </div>
  </div>
</template>
