import { onUnmounted, ref, unref, type MaybeRef } from 'vue'
import { api } from '@/lib/api'

const SAVE_THROTTLE_MS = 5_000

export interface AudioProgressOptions {
  trackingEnabled?: MaybeRef<boolean>
}

export function useAudioProgress(bookId: number, options: AudioProgressOptions = {}) {
  const resumeFileId = ref<number | null>(null)
  const resumePosition = ref(0)
  const loaded = ref(false)
  const trackingEnabled = options.trackingEnabled ?? true

  let pendingFileId: number | null = null
  let pendingPosition = 0
  let pendingPercentage = 0
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let dirty = false

  async function load() {
    if (!unref(trackingEnabled)) {
      loaded.value = true
      return
    }
    const res = await api(`/api/v1/books/${bookId}/audio-progress`)
    // Mark loaded regardless of response so callers can distinguish
    // "load attempted" from "load not yet called".
    loaded.value = true
    if (!res.ok) return
    const data = await res.json()
    if (data) {
      resumeFileId.value = data.currentFileId ?? null
      resumePosition.value = data.positionSeconds ?? 0
    }
  }

  function update(fileId: number, positionSeconds: number, percentage: number) {
    if (!unref(trackingEnabled)) return
    pendingFileId = fileId
    pendingPosition = positionSeconds
    pendingPercentage = percentage
    dirty = true

    if (!saveTimer) {
      saveTimer = setTimeout(() => {
        saveTimer = null
        flushIfDirty()
      }, SAVE_THROTTLE_MS)
    }
  }

  function flushIfDirty() {
    if (!unref(trackingEnabled)) return
    if (!dirty || pendingFileId === null) return
    const body = JSON.stringify({
      percentage: pendingPercentage,
      currentFileId: pendingFileId,
      positionSeconds: pendingPosition,
    })
    dirty = false
    api(`/api/v1/books/${bookId}/audio-progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {
      dirty = true
    })
  }

  function flush() {
    if (!unref(trackingEnabled)) return
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    flushIfDirty()
  }

  onUnmounted(flush)

  return { resumeFileId, resumePosition, loaded, load, update, flush }
}
