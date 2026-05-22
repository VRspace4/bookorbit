import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { TtsProviderConfigurations, TtsProviderStatus } from '@bookorbit/types'

export function useTtsProviderConfig() {
  const config = ref<TtsProviderConfigurations | null>(null)
  const statuses = ref<TtsProviderStatus[]>([])
  const loading = ref(false)
  const saving = ref(false)

  async function fetchConfig() {
    loading.value = true
    try {
      const res = await api('/api/v1/tts/providers')
      if (!res.ok) return
      const data: { config: TtsProviderConfigurations; statuses: TtsProviderStatus[] } = await res.json()
      config.value = data.config
      statuses.value = data.statuses
    } finally {
      loading.value = false
    }
  }

  async function saveConfig(patch: Partial<TtsProviderConfigurations>) {
    saving.value = true
    try {
      const res = await api('/api/v1/tts/providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        await fetchConfig()
        toast.success('Text-to-speech provider settings saved')
      } else {
        const data = await res.json().catch(() => null)
        const message = typeof data?.message === 'string' ? data.message : 'Failed to save text-to-speech provider settings'
        toast.error(message)
      }
    } finally {
      saving.value = false
    }
  }

  return { config, statuses, loading, saving, fetchConfig, saveConfig }
}
