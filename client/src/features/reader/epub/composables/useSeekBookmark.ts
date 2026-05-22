import { ref } from 'vue'

export type SeekBookmark = {
  fraction: number
  cfi: string | null
}

const SEEK_THRESHOLD = 0.01

export function useSeekBookmark(getCurrent: () => { fraction: number; cfi: string | null }) {
  const seekBookmark = ref<SeekBookmark | null>(null)

  function placeBookmarkBeforeSeek(newFraction: number) {
    if (seekBookmark.value) return

    const { fraction, cfi } = getCurrent()
    if (Math.abs(newFraction - fraction) > SEEK_THRESHOLD) {
      seekBookmark.value = { fraction, cfi }
    }
  }

  function clearBookmark() {
    seekBookmark.value = null
  }

  return { seekBookmark, placeBookmarkBeforeSeek, clearBookmark }
}
