<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { PDFViewer, ScrollPlugin, ViewportPlugin, ScrollStrategy, SpreadMode, ZoomMode } from '@embedpdf/vue-pdf-viewer'
import type { PDFViewerConfig, PluginRegistry, ScrollCapability, ViewportCapability, EmbedPdfContainer } from '@embedpdf/vue-pdf-viewer'
import { getAccessToken } from '@/lib/api'
import { useReaderProgress } from '../shared/composables/useReaderProgress'
import { useReadingSession } from '../shared/composables/useReadingSession'
import { useReaderSettings } from '../shared/composables/useReaderSettings'
import { exitReader } from '../shared/lib/reader-navigation'
import { useThemeStore, ACCENT_OPTIONS } from '@/stores/theme'
import type { PdfReaderSettings } from '@bookorbit/types'
import { getIsDark, lookupAccentHex } from './pdf-viewer-utils'

const props = defineProps<{ bookId: number; fileId: number }>()

const themeStore = useThemeStore()
const router = useRouter()

const bookSettings = useReaderSettings(props.fileId, 'pdf')
const { onActivity, elapsedMinutes } = useReadingSession(props.fileId, () => ({
  percentage: progress.percentage.value,
  pageNumber: progress.pageNumber.value,
}))
const progress = useReaderProgress(props.bookId, props.fileId, elapsedMinutes)

let unsubPageChange: (() => void) | null = null
let unsubScroll: (() => void) | null = null
let unsubLayoutReady: (() => void) | null = null
let themeObserver: MutationObserver | null = null
let viewerContainer: EmbedPdfContainer | null = null
let progressTrackingEnabled = false
let restoreActive = false
let savedPage: number | null = null
let savedScrollY: number | null = null

function buildThemeConfig() {
  const isDark = getIsDark()
  const accentHex = lookupAccentHex(themeStore.accent, ACCENT_OPTIONS)
  return {
    preference: isDark ? ('dark' as const) : ('light' as const),
    light: { accent: { primary: accentHex } },
    dark: { accent: { primary: accentHex } },
  }
}

function scheduleSave(pageNumber: number, totalPages: number, scrollY: number) {
  if (!progressTrackingEnabled) return
  progress.pageNumber.value = pageNumber
  progress.percentage.value = totalPages > 0 ? (pageNumber / totalPages) * 100 : 0
  progress.positionSeconds.value = scrollY
  progress.scheduleSave()
}

function scrollOffsetY(metrics: { scrollOffset?: { y: number } } | undefined) {
  return metrics?.scrollOffset?.y ?? 0
}

function syncProgressFromMetrics(scroll: ScrollCapability) {
  const metrics = scroll.getMetrics()
  const totalPages = scroll.getTotalPages()
  progress.pageNumber.value = metrics.currentPage
  progress.percentage.value = totalPages > 0 ? (metrics.currentPage / totalPages) * 100 : 0
  progress.positionSeconds.value = scrollOffsetY(metrics)
}

function finishProgressRestore(scroll: ScrollCapability) {
  restoreActive = false
  syncProgressFromMetrics(scroll)
  progressTrackingEnabled = true
}

function isRestoreComplete(scroll: ScrollCapability, page: number) {
  const metrics = scroll.getMetrics()
  return page <= 1 || metrics.currentPage === page
}

function attemptRestore(scroll: ScrollCapability, viewport: ViewportCapability | undefined, attempt: number) {
  if (!restoreActive) return

  const page = savedPage ?? 1
  const scrollY = savedScrollY
  const totalPages = scroll.getTotalPages()

  if (page > 1 && page <= totalPages) {
    scroll.scrollToPage({ pageNumber: page, behavior: 'instant' })
  } else if (scrollY != null && scrollY > 0 && viewport) {
    viewport.scrollTo({ x: 0, y: scrollY, behavior: 'instant' })
  }

  requestAnimationFrame(() => {
    if (!restoreActive) return

    if (isRestoreComplete(scroll, page)) {
      finishProgressRestore(scroll)
      return
    }

    if (attempt < 12) {
      setTimeout(() => attemptRestore(scroll, viewport, attempt + 1), 150)
      return
    }

    finishProgressRestore(scroll)
  })
}

function queueRestore(scroll: ScrollCapability, viewport: ViewportCapability | undefined) {
  if (!restoreActive) return
  requestAnimationFrame(() => requestAnimationFrame(() => attemptRestore(scroll, viewport, 0)))
}

const configReady = ref(false)
const viewerConfig = ref<PDFViewerConfig>({})

onMounted(async () => {
  await bookSettings.load()

  const settings = bookSettings.effective.value as PdfReaderSettings
  const token = getAccessToken()

  viewerConfig.value = {
    theme: buildThemeConfig(),
    tabBar: 'never',
    disabledCategories: [
      'annotation',
      'signature',
      'form',
      'document-print',
      'export',
      'insert',
      'redaction',
      'document-open',
      'document-close',
      'document-protect',
      'document-export',
    ],
    scroll: {
      defaultStrategy: settings.scrollMode === 'horizontal' ? ScrollStrategy.Horizontal : ScrollStrategy.Vertical,
    },
    spread: {
      defaultSpreadMode: settings.spread === 'odd' ? SpreadMode.Odd : settings.spread === 'even' ? SpreadMode.Even : SpreadMode.None,
    },
    zoom: {
      defaultZoomLevel:
        settings.zoomMode === 'fit-width' ? ZoomMode.FitWidth : settings.zoomMode === 'fit-page' ? ZoomMode.FitPage : settings.customScale,
    },
    documentManager: {
      initialDocuments: [
        {
          url: `/api/v1/books/files/${props.fileId}/serve`,
          requestOptions: {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          },
        },
      ],
    },
  }

  configReady.value = true
})

function handleInit(container: EmbedPdfContainer) {
  viewerContainer = container
}

function handleReady(registry: PluginRegistry) {
  setupProgressTracking(registry)
  setupSettingsPersistence(registry)
  setupThemeSync()
}

async function setupProgressTracking(registry: PluginRegistry) {
  await progress.load()
  savedPage = progress.pageNumber.value
  savedScrollY = progress.positionSeconds.value

  const scroll = registry.getPlugin<InstanceType<typeof ScrollPlugin>>(ScrollPlugin.id)?.provides() as ScrollCapability | undefined
  const viewport = registry.getPlugin<InstanceType<typeof ViewportPlugin>>(ViewportPlugin.id)?.provides() as ViewportCapability | undefined

  if (!scroll) return

  const hasSavedPosition = (savedPage ?? 1) > 1 || (savedScrollY ?? 0) > 0
  restoreActive = hasSavedPosition
  progressTrackingEnabled = !hasSavedPosition

  unsubLayoutReady = scroll.onLayoutReady(({ isInitial }) => {
    if (isInitial && restoreActive) queueRestore(scroll, viewport)
  })

  unsubPageChange = scroll.onPageChange(({ pageNumber, totalPages }) => {
    onActivity()
    scheduleSave(pageNumber, totalPages, scrollOffsetY(scroll.getMetrics()))
  })

  unsubScroll = scroll.onScroll((event) => {
    const metrics = 'metrics' in event ? event.metrics : event
    const totalPages = scroll.getTotalPages()
    scheduleSave(metrics.currentPage, totalPages, scrollOffsetY(metrics))
  })
}

function setupSettingsPersistence(registry: PluginRegistry) {
  const scroll = registry.getPlugin<InstanceType<typeof ScrollPlugin>>(ScrollPlugin.id)?.provides() as ScrollCapability | undefined

  if (scroll) {
    scroll.onStateChange((state) => {
      const strategy = state.strategy
      if (strategy) {
        bookSettings.updateBookSettings({ scrollMode: strategy as PdfReaderSettings['scrollMode'] })
      }
    })
  }
}

function setupThemeSync() {
  themeObserver = new MutationObserver(() => {
    if (!viewerContainer) return
    viewerContainer.setTheme(buildThemeConfig())
  })

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
}

async function handleBack() {
  await progress.flush()
  await exitReader(router)
}

onBeforeRouteLeave(async () => {
  await progress.flush()
  return true
})

onUnmounted(() => {
  restoreActive = false
  unsubPageChange?.()
  unsubScroll?.()
  unsubLayoutReady?.()
  themeObserver?.disconnect()
})
</script>

<template>
  <div class="fixed inset-0 flex flex-col">
    <div class="flex h-10 shrink-0 items-center border-b border-border bg-background px-2">
      <button
        type="button"
        class="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Exit reader"
        @click="handleBack"
      >
        Exit
      </button>
    </div>
    <PDFViewer v-if="configReady" :config="viewerConfig" style="flex: 1; min-height: 0" @init="handleInit" @ready="handleReady" />
  </div>
</template>
