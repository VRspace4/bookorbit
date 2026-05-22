import { reactive, ref } from 'vue'
import { emptyTtsMonthlyUsage, type TtsMonthlyUsage, type TtsProvider } from '@bookorbit/types'
import { api } from '@/lib/api'

const usage = reactive<TtsMonthlyUsage>(emptyTtsMonthlyUsage())
const loaded = ref(false)
let inflight: Promise<void> | null = null

function applyUsage(next: Partial<TtsMonthlyUsage>) {
  Object.assign(usage, emptyTtsMonthlyUsage(), next)
}

export function useTtsUsage() {
  async function fetchUsage(force = false) {
    if (loaded.value && !force) return
    if (inflight) return inflight

    inflight = (async () => {
      try {
        const res = await api('/api/v1/tts/usage')
        if (res.ok) {
          applyUsage((await res.json()) as TtsMonthlyUsage)
        }
      } catch {
        // ignore network failures; pills fall back to local counts
      } finally {
        loaded.value = true
        inflight = null
      }
    })()

    return inflight
  }

  async function reportUsage(provider: TtsProvider, characters: number) {
    if (characters <= 0) return
    usage[provider] += characters
    try {
      await api('/api/v1/tts/usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, characters }),
      })
    } catch {
      // keep optimistic local count even if persistence fails
    }
  }

  /** Test helper for injecting usage without hitting the API. */
  function setUsage(next: Partial<TtsMonthlyUsage>) {
    applyUsage(next)
    loaded.value = true
  }

  return { usage, fetchUsage, reportUsage, setUsage }
}
