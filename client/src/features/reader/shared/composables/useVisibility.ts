import { onMounted, onUnmounted, ref } from 'vue'

export const READER_DESKTOP_MIN_WIDTH = 768

export function isReaderDesktopViewport() {
  return typeof window !== 'undefined' && window.matchMedia(`(min-width: ${READER_DESKTOP_MIN_WIDTH}px)`).matches
}

export function useVisibility() {
  const desktopDefaultVisible = isReaderDesktopViewport()
  const headerVisible = ref(desktopDefaultVisible)
  const footerVisible = ref(desktopDefaultVisible)

  let isPinned = desktopDefaultVisible
  let isVisibilityLocked = false
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let desktopMediaQuery: MediaQueryList | null = null

  const HEADER_TRIGGER = 24
  const FOOTER_TRIGGER = 24

  function clearHideTimer() {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = null
  }

  function scheduleHide() {
    if (isReaderDesktopViewport() && isPinned) return

    clearHideTimer()
    hideTimer = setTimeout(() => {
      if (!isPinned && !isVisibilityLocked) {
        headerVisible.value = false
        footerVisible.value = false
      }
    }, 3000)
  }

  function applyViewportDefaults() {
    if (isVisibilityLocked) return

    if (isReaderDesktopViewport()) {
      isPinned = true
      headerVisible.value = true
      footerVisible.value = true
      clearHideTimer()
      return
    }

    isPinned = false
    headerVisible.value = false
    footerVisible.value = false
    clearHideTimer()
  }

  function onMouseMove(e: MouseEvent) {
    if (isVisibilityLocked) return
    if (isReaderDesktopViewport() && isPinned) return

    const y = e.clientY
    const height = window.innerHeight

    if (!isPinned) {
      if (y < HEADER_TRIGGER) {
        headerVisible.value = true
        scheduleHide()
      } else if (headerVisible.value) {
        scheduleHide()
      }

      if (y > height - FOOTER_TRIGGER) {
        footerVisible.value = true
        scheduleHide()
      } else if (footerVisible.value) {
        scheduleHide()
      }
    }
  }

  function handleMiddleTap() {
    if (isVisibilityLocked) return

    isPinned = !isPinned
    headerVisible.value = isPinned
    footerVisible.value = isPinned
    if (!isPinned) {
      clearHideTimer()
    }
  }

  function showHeader() {
    if (isVisibilityLocked) {
      headerVisible.value = true
      return
    }

    if (isPinned) {
      headerVisible.value = true
      return
    }

    headerVisible.value = true
    scheduleHide()
  }

  function showFooter() {
    if (isVisibilityLocked) {
      footerVisible.value = true
      return
    }

    if (isPinned) {
      footerVisible.value = true
      return
    }

    footerVisible.value = true
    scheduleHide()
  }

  function setVisibilityLock(locked: boolean) {
    isVisibilityLocked = locked

    clearHideTimer()

    if (locked) {
      headerVisible.value = true
      return
    }

    if (isPinned || isReaderDesktopViewport()) {
      headerVisible.value = true
      footerVisible.value = true
      return
    }

    headerVisible.value = false
    footerVisible.value = false
  }

  onMounted(() => {
    document.addEventListener('mousemove', onMouseMove)
    desktopMediaQuery = window.matchMedia(`(min-width: ${READER_DESKTOP_MIN_WIDTH}px)`)
    desktopMediaQuery.addEventListener('change', applyViewportDefaults)
    applyViewportDefaults()
  })

  onUnmounted(() => {
    document.removeEventListener('mousemove', onMouseMove)
    desktopMediaQuery?.removeEventListener('change', applyViewportDefaults)
    clearHideTimer()
  })

  return { headerVisible, footerVisible, handleMiddleTap, onMouseMove, showHeader, showFooter, setVisibilityLock }
}
