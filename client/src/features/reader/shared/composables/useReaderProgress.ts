import { onUnmounted, ref, type Ref } from 'vue'
import { api, getAccessToken } from '@/lib/api'
import type { FoliateRenderer, RelocateDetail } from '../../epub/composables/useFoliate'
import { readCachedReaderProgress, writeCachedReaderProgress } from '../lib/reader-progress-cache'

export type FooterDisplayMode = 0 | 1 | 2

export function formatTimeRemaining(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return ''
  if (minutes < 1) return '< 1 min'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const remainder = Math.round(minutes % 60)
  if (remainder === 0) return `${hours} hr`
  return `${hours} hr ${remainder} min`
}

export function useReaderProgress(bookId: number, fileId: number, elapsedMinutes: Ref<number>, initialFooterMode: FooterDisplayMode = 0) {
  const cfi = ref<string | null>(null)
  const pageNumber = ref<number | null>(null)
  const positionSeconds = ref<number | null>(null)
  const percentage = ref(0)
  const chapterTitle = ref('')
  const sectionIndex = ref(0)
  const totalSections = ref(0)
  const fraction = ref(0)

  const locationCurrent = ref(0)
  const locationTotal = ref(0)
  const sectionCurrent = ref(0)
  const sectionTotal = ref(0)
  const timeSection = ref(0)
  const timeTotal = ref(0)

  const footerMode = ref<FooterDisplayMode>(initialFooterMode)
  const ttsSectionIndex = ref<number | null>(null)
  const ttsWordIndex = ref<number | null>(null)

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let dirty = false

  function currentSnapshot() {
    return {
      cfi: cfi.value,
      pageNumber: pageNumber.value,
      percentage: percentage.value,
      positionSeconds: positionSeconds.value,
      ttsSectionIndex: ttsSectionIndex.value,
      ttsWordIndex: ttsWordIndex.value,
    }
  }

  function applyProgressSnapshot(data: {
    cfi?: string | null
    pageNumber?: number | null
    positionSeconds?: number | null
    percentage?: number | null
    ttsSectionIndex?: number | null
    ttsWordIndex?: number | null
  }) {
    cfi.value = data.cfi ?? null
    pageNumber.value = data.pageNumber ?? null
    positionSeconds.value = data.positionSeconds ?? null
    percentage.value = typeof data.percentage === 'number' && Number.isFinite(data.percentage) ? data.percentage : 0
    ttsSectionIndex.value =
      typeof data.ttsSectionIndex === 'number' && Number.isInteger(data.ttsSectionIndex) && data.ttsSectionIndex >= 0 ? data.ttsSectionIndex : null
    ttsWordIndex.value =
      typeof data.ttsWordIndex === 'number' && Number.isInteger(data.ttsWordIndex) && data.ttsWordIndex >= 0 ? data.ttsWordIndex : null
  }

  function getTtsPosition(): { sectionIndex: number; wordIndex: number } | null {
    if (ttsSectionIndex.value === null || ttsWordIndex.value === null) return null
    return { sectionIndex: ttsSectionIndex.value, wordIndex: ttsWordIndex.value }
  }

  function updateTtsPosition(sectionIndex: number, wordIndex: number) {
    if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || !Number.isInteger(wordIndex) || wordIndex < 0) return
    ttsSectionIndex.value = sectionIndex
    ttsWordIndex.value = wordIndex
    cacheCurrentProgress()
    scheduleSave()
  }

  function cacheCurrentProgress(updatedAt?: string | null) {
    writeCachedReaderProgress(fileId, { ...currentSnapshot(), updatedAt })
  }

  function scheduleSave() {
    dirty = true
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushIfDirty()
    }, 2000)
  }

  async function flushIfDirty() {
    if (!dirty) return
    dirty = false
    try {
      await save()
    } catch {
      dirty = true
      throw new Error('Failed to save reading progress')
    }
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    return flushIfDirty()
  }

  function flushKeepalive() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!dirty) return
    dirty = false
    cacheCurrentProgress()
    const body = JSON.stringify(currentSnapshot())
    fetch(`/api/v1/books/files/${fileId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}) },
      body,
      credentials: 'include',
      keepalive: true,
    }).catch(() => {
      dirty = true
    })
  }

  onUnmounted(() => {
    flushKeepalive()
  })

  async function load() {
    const cached = readCachedReaderProgress(fileId)
    if (cached) {
      applyProgressSnapshot(cached)
    }

    const res = await api(`/api/v1/books/files/${fileId}/progress`)
    if (!res.ok) return
    const data = await res.json()
    const remoteUpdatedAt = typeof data.updatedAt === 'string' ? Date.parse(data.updatedAt) : 0
    const cachedUpdatedAt = cached ? Date.parse(cached.updatedAt) : 0

    if (cached && cachedUpdatedAt > remoteUpdatedAt) {
      applyProgressSnapshot(cached)
      void save().catch(() => {
        dirty = true
      })
      return
    }

    applyProgressSnapshot(data)
    cacheCurrentProgress(typeof data.updatedAt === 'string' ? data.updatedAt : undefined)
  }

  function onRelocate(detail: RelocateDetail) {
    cfi.value = detail?.cfi ?? null
    fraction.value = detail?.fraction ?? 0
    percentage.value = fraction.value * 100
    chapterTitle.value = detail?.tocItem?.label ?? ''
    sectionIndex.value = detail?.section?.current ?? detail?.index ?? 0
    totalSections.value = detail?.section?.total ?? detail?.total ?? 0

    locationCurrent.value = detail?.location?.current ?? 0
    locationTotal.value = detail?.location?.total ?? 0
    sectionCurrent.value = detail?.section?.current ?? 0
    sectionTotal.value = detail?.section?.total ?? 0
    timeSection.value = detail?.time?.section ?? 0
    timeTotal.value = detail?.time?.total ?? 0

    cacheCurrentProgress()
    scheduleSave()
  }

  async function save() {
    cacheCurrentProgress()
    await api(`/api/v1/books/files/${fileId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentSnapshot()),
    })
  }

  function cycleFooterMode() {
    footerMode.value = ((footerMode.value + 1) % 3) as FooterDisplayMode
  }

  function buildFooterContent(mode: FooterDisplayMode): { left: string; right: string } {
    const pct = Math.round(fraction.value * 100)

    switch (mode) {
      case 0: {
        const left = locationTotal.value > 0 ? `Page ${locationCurrent.value + 1} of ${locationTotal.value}` : ''
        return { left, right: `${pct}%` }
      }
      case 1: {
        const elapsed = elapsedMinutes.value
        const left = elapsed > 0 ? `Reading: ${elapsed}m` : 'Reading: < 1m'
        const right = timeTotal.value > 0 ? `${formatTimeRemaining(timeTotal.value)} left` : `${pct}%`
        return { left, right }
      }
      case 2: {
        const left = sectionTotal.value > 0 ? `Ch. ${sectionCurrent.value + 1} of ${sectionTotal.value}` : ''
        const right = timeSection.value > 0 ? `${formatTimeRemaining(timeSection.value)} left in ch.` : `${pct}%`
        return { left, right }
      }
    }
  }

  function updateHeadsFeet(renderer: FoliateRenderer, theme: { fg: string; bg: string }) {
    if (!renderer || !renderer.heads?.length) return

    const columnCount = renderer.heads.length
    const isSingleColumn = columnCount === 1
    const DEFAULT_FONT_SIZE = '0.875rem'

    const buildStyle = () => {
      const base = `width: 100%; display: flex; justify-content: space-between; align-items: center; font-size: ${DEFAULT_FONT_SIZE}; font-family: inherit;`
      return `${base} color: ${theme.fg};`
    }

    const style = buildStyle()

    renderer.heads.forEach((headEl: HTMLElement, index: number) => {
      if (!headEl) return
      headEl.style.visibility = 'visible'
      const div = document.createElement('div')
      div.style.cssText = style

      if (isSingleColumn) {
        const spacer = document.createElement('span')
        const chapterSpan = document.createElement('span')
        chapterSpan.textContent = chapterTitle.value || ''
        chapterSpan.style.textAlign = 'right'
        div.style.justifyContent = 'left'
        div.appendChild(spacer)
        div.appendChild(chapterSpan)
      } else {
        if (index === 0) {
          const chapterSpan = document.createElement('span')
          chapterSpan.textContent = chapterTitle.value || ''
          chapterSpan.style.textAlign = 'left'
          div.appendChild(chapterSpan)
        }
      }

      headEl.replaceChildren(div)
    })

    if (!renderer.feet?.length) return

    const { left, right } = buildFooterContent(footerMode.value)
    const totalCols = renderer.feet.length

    renderer.feet.forEach((footEl: HTMLElement, index: number) => {
      if (!footEl) return
      const div = document.createElement('div')
      div.style.cssText = style
      div.style.cursor = 'pointer'
      div.addEventListener('click', (e) => {
        e.stopPropagation()
        cycleFooterMode()
        updateHeadsFeet(renderer, theme)
      })

      if (isSingleColumn) {
        const leftSpan = document.createElement('span')
        leftSpan.textContent = left
        leftSpan.style.textAlign = 'left'

        const rightSpan = document.createElement('span')
        rightSpan.textContent = right
        rightSpan.style.textAlign = 'right'

        div.appendChild(leftSpan)
        div.appendChild(rightSpan)
      } else {
        if (index === 0) {
          const leftSpan = document.createElement('span')
          leftSpan.textContent = left
          leftSpan.style.textAlign = 'left'
          div.appendChild(leftSpan)
          div.appendChild(document.createElement('span'))
        } else if (index === totalCols - 1) {
          const spacer = document.createElement('span')
          div.appendChild(spacer)

          const rightSpan = document.createElement('span')
          rightSpan.textContent = right
          rightSpan.style.textAlign = 'right'
          div.appendChild(rightSpan)
        }
      }

      footEl.replaceChildren(div)
    })
  }

  return {
    cfi,
    pageNumber,
    positionSeconds,
    percentage,
    chapterTitle,
    sectionIndex,
    totalSections,
    fraction,
    locationCurrent,
    locationTotal,
    sectionCurrent,
    sectionTotal,
    timeSection,
    timeTotal,
    footerMode,
    ttsSectionIndex,
    ttsWordIndex,
    load,
    onRelocate,
    save,
    scheduleSave,
    flush,
    getTtsPosition,
    updateTtsPosition,
    cycleFooterMode,
    updateHeadsFeet,
  }
}
