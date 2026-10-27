<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { useFoliate, type RelocateDetail } from './epub/composables/useFoliate'
import { useReaderProgress } from './shared/composables/useReaderProgress'
import { useReadingSession } from './shared/composables/useReadingSession'
import { leaveReader } from './shared/lib/reader-navigation'
import { useReaderState } from './epub/composables/useReaderState'
import { useReaderSettings } from './shared/composables/useReaderSettings'
import { useCustomFonts } from './epub/composables/useCustomFonts'
import { useVisibility } from './shared/composables/useVisibility'
import { useWakeLock } from './shared/composables/useWakeLock'
import { useBookmarks } from './epub/composables/useBookmarks'
import { useSeekBookmark } from './epub/composables/useSeekBookmark'
import { useAnnotations } from './epub/composables/useAnnotations'
import { useToc } from './epub/composables/useToc'
import { useSearch, type FoliateView } from './epub/composables/useSearch'
import { useReaderSelection } from './epub/composables/useReaderSelection'
import { useReaderKeyboardShortcuts } from './epub/composables/useReaderKeyboardShortcuts'
import { useEpubTts } from './epub/composables/useEpubTts'
import ReaderHeader from './epub/components/ReaderHeader.vue'
import ReaderFooter from './epub/components/ReaderFooter.vue'
import ReaderSidebar from './epub/components/ReaderSidebar.vue'
import ReaderSettingsPanel from './epub/components/ReaderSettingsPanel.vue'
import TtsControls from './epub/components/TtsControls.vue'
import TtsFollowAlongButton from './epub/components/TtsFollowAlongButton.vue'
import TtsSettingsPanel from './epub/components/TtsSettingsPanel.vue'
import TtsHighlightColorPanel from './epub/components/TtsHighlightColorPanel.vue'
import SelectionPopup from './epub/components/SelectionPopup.vue'
import ReaderSearchPanel from './epub/components/ReaderSearchPanel.vue'
import NoteDialog from './epub/components/NoteDialog.vue'
import DictionaryPopover from './epub/components/DictionaryPopover.vue'
import TranslationPopover from './epub/components/TranslationPopover.vue'
import TranslationSheet from './epub/components/TranslationSheet.vue'
import KeyboardShortcutsModal from './epub/components/KeyboardShortcutsModal.vue'
import TtsResumeDialog from './epub/components/TtsResumeDialog.vue'
import PdfV4ReaderView from './pdf-v4/PdfV4ReaderView.vue'
import CbzReaderView from './cbz/CbzReaderView.vue'
import AudiobookReaderView from './audiobook/AudiobookReaderView.vue'
import { epubReaderUiKey, type ReaderState } from './epub/composables/useReaderState'
import type { FoliateRenderer } from './epub/composables/useFoliate'
import type { EpubReaderSettings } from '@bookorbit/types'
import { getFormatGroup } from '@bookorbit/types'
import { buildThemeHighlightPatch, buildThemeSwitchHighlightPatch } from './epub/theme-highlight'
import { readCachedReaderProgress } from './shared/lib/reader-progress-cache'
import { readTtsPlaybackSession, writeTtsPlaybackSession } from './epub/tts/tts-session-cache'
import { isAwayFromLastTtsPosition } from './epub/lib/tts-resume'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const bookId = Number(route.params.bookId)
const fileId = Number(route.params.fileId)
const isPeekMode = computed(() => route.query.peek === '1' || route.query.peek === 'true')
const trackingEnabled = computed(() => !isPeekMode.value)
const fileFormat = (route.query.format as string) || 'epub'
const isAudioFormat = getFormatGroup(fileFormat) === 'audio'
const isPdfFormat = fileFormat === 'pdf'
const isComicFormat = fileFormat === 'cbz' || fileFormat === 'cbr' || fileFormat === 'cb7'

const containerRef = ref<HTMLElement | null>(null)
const readerShellRef = ref<HTMLElement | null>(null)
const ttsToolbarRef = ref<InstanceType<typeof TtsControls> | null>(null)
let ttsToolbarResizeObserver: ResizeObserver | null = null
const showSidebar = ref(false)
const showSettings = ref(false)
const showSearch = ref(false)
const showTtsSettings = ref(false)
const ttsColorPickerTarget = ref<'sentence' | 'word' | null>(null)
const showTtsResumeDialog = ref(false)
const pendingTtsResume = ref<{ sectionIndex: number; wordIndex: number } | null>(null)
const ttsAutoAdvancing = ref(false)
const searchInitialQuery = ref('')
const isFullscreen = ref(false)
const sectionFractions = ref<number[]>([])

const bookSettings = useReaderSettings(fileId, fileFormat)
const effectiveEpubSettings = computed(() => bookSettings.effective.value as EpubReaderSettings)
// False when overrideBookFormatting is off and the book has no per-book delta.
// Prevents injecting any CSS so the book renders with its own embedded styles.
const shouldApplyStyles = ref(true)

const readerState = useReaderState()
const {
  state,
  activeMode,
  isDark,
  applyToRenderer,
  setFontSize,
  setLineHeight,
  setFontFamily,
  setMaxColumnCount,
  setGap,
  setMaxInlineSize,
  setMaxBlockSize,
  setJustify,
  setHyphenate,
  setIsDark,
  setThemeName,
  setFlow,
  setFontFaceCSS,
  setFixedLayoutSpread,
} = readerState

const customFonts = useCustomFonts()

const { onActivity, elapsedMinutes } = useReadingSession(fileId, () => ({
  percentage: progress.percentage.value,
  cfi: progress.cfi.value,
  pageNumber: progress.pageNumber.value,
}))

const progress = useReaderProgress(bookId, fileId, elapsedMinutes, 0, { trackingEnabled })
const { cfi, chapterTitle, sectionIndex, totalSections, fraction, locationTotal, footerMode, cycleFooterMode, updateHeadsFeet } = progress

const { seekBookmark, placeBookmarkBeforeSeek, clearBookmark } = useSeekBookmark(() => ({
  fraction: fraction.value,
  cfi: cfi.value,
}))

function handleSeek(newFraction: number) {
  placeBookmarkBeforeSeek(newFraction)
  goToFraction(newFraction)
}

function handleSeekBookmarkTap() {
  const bookmark = seekBookmark.value
  if (!bookmark) return
  if (bookmark.cfi) {
    goTo(bookmark.cfi)
  } else {
    goToFraction(bookmark.fraction)
  }
}

const visibility = useVisibility()
const { headerVisible, footerVisible, handleMiddleTap, setVisibilityLock } = visibility

watch([headerVisible, footerVisible], ([header, footer]) => {
  if (!header && !footer) {
    clearBookmark()
  }
})

watch(
  () => bookSettings.deviceFormFactor.value,
  () => {
    if (isAudioFormat || isPdfFormat || isComicFormat) return
    if (!shouldApplyStyles.value && !bookSettings.isCustomized.value) return

    const effective = bookSettings.effective.value as EpubReaderSettings
    seedState(effective)
    const renderer = getRenderer()
    if (renderer) applyToRenderer(renderer)
  },
)

useWakeLock()

const bookmarks = useBookmarks()
const annotations = useAnnotations()

const toc = useToc()
const { chapters, expandedHrefs, activeHref, setChapters, toggleExpand } = toc

const search = useSearch()
const { results: searchResults, isSearching, search: doSearch, clear: clearSearch } = search

const selection = useReaderSelection()

function closeAnyPanel() {
  if (showSearch.value) {
    closeSearch()
  } else if (showSidebar.value) {
    showSidebar.value = false
  } else if (showSettings.value) {
    showSettings.value = false
  } else if (showTtsSettings.value) {
    showTtsSettings.value = false
  } else if (ttsColorPickerTarget.value) {
    ttsColorPickerTarget.value = null
  } else {
    handleMiddleTap()
  }
}

const { showHelpModal } = useReaderKeyboardShortcuts({
  toggleSidebar: () => {
    showSidebar.value = !showSidebar.value
  },
  toggleSearch: () => {
    showSearch.value = !showSearch.value
  },
  toggleBookmark: () => {
    bookmarks.toggle(bookId, cfi.value ?? '', chapterTitle.value)
  },
  toggleFullscreen,
  cycleFooterMode,
  closePanel: closeAnyPanel,
  goToStart: () => goToFraction(0),
  goToEnd: () => goToFraction(1),
})

function toggleHelpModal() {
  showHelpModal.value = !showHelpModal.value
}

const chapterStartFraction = computed(() => {
  const fracs = sectionFractions.value
  const idx = sectionIndex.value
  return fracs[idx] ?? 0
})

const chapterEndFraction = computed(() => {
  const fracs = sectionFractions.value
  const idx = sectionIndex.value
  return fracs[idx + 1] ?? 1
})

const showDictionary = ref(false)
const dictionaryWord = ref('')
const dictionaryPosition = ref({ x: 0, y: 0, showBelow: false })

const showTranslation = ref(false)
const translationText = ref('')
const translationPosition = ref({ x: 0, y: 0, showBelow: false })
const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

function handleDefine() {
  dictionaryWord.value = selection.text.value
  dictionaryPosition.value = {
    x: selection.position.value.x,
    y: selection.position.value.y,
    showBelow: selection.showBelow.value,
  }
  selection.dismiss()
  showDictionary.value = true
}

function handleTranslate() {
  translationText.value = selection.text.value
  translationPosition.value = {
    x: selection.position.value.x,
    y: selection.position.value.y,
    showBelow: selection.showBelow.value,
  }
  selection.dismiss()
  showTranslation.value = true
}

function onRelocateHandler(detail: RelocateDetail) {
  // While the book is opening, Foliate may emit an intermediate relocate at the
  // chapter start before the exact CFI page/scroll is applied. Keep in-memory
  // state in sync but do not persist those intermediate positions.
  const persist = !loading.value && !restoring.value
  progress.onRelocate(detail, { persist })
  if (tts.isActive.value) tts.evaluateScrollFollow()
  onActivity()
  bookmarks.setCfi(detail?.cfi ?? null)
  toc.setActiveHref(detail?.tocItem?.href ?? '')
  const renderer = getRenderer()
  if (renderer) {
    updateHeadsFeet(renderer, activeMode.value)
  }
}

function onApplyStylesHandler(renderer: FoliateRenderer) {
  if (shouldApplyStyles.value) {
    applyToRenderer(renderer)
  }
}

function onMiddleTapHandler() {
  handleMiddleTap()
}

let handleLoadedDocument: ((doc: Document) => void) | null = null

function onDocumentLoadHandler(doc: Document) {
  handleLoadedDocument?.(doc)
}

const {
  loading,
  restoring,
  error,
  open,
  goTo,
  goToFraction,
  goToSection,
  getSectionFractions,
  getChapters,
  getRenderer,
  getActiveDocument,
  addAnnotation,
  addAnnotations,
  deleteAnnotation,
  setTextSelectedHandler,
  view: foliateView,
  bookLanguage,
  waitForInitialRestore,
} = useFoliate(() => containerRef.value, onRelocateHandler, onApplyStylesHandler, onMiddleTapHandler, onDocumentLoadHandler)

function alignTtsSessionWithProgress(position = progress.getTtsPosition()) {
  const saved = position
  if (!saved) return
  const session = readTtsPlaybackSession(fileId)
  if (!session?.enabled) return
  // Keep wasPlaying so reload can auto-resume audio when appropriate.
  writeTtsPlaybackSession(fileId, {
    enabled: true,
    wasPlaying: session.wasPlaying,
    sectionIndex: saved.sectionIndex,
    wordIndex: saved.wordIndex,
  })
}

async function waitForActiveSection(targetSection: number, timeoutMs = 12_000): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const doc = getActiveDocument()
    if (sectionIndex.value === targetSection && doc?.body) {
      await nextTick()
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0)
      })
      return true
    }
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 50)
    })
  }
  return sectionIndex.value === targetSection && Boolean(getActiveDocument()?.body)
}

async function ensureReaderAtTtsPosition(saved: { sectionIndex: number; wordIndex: number }) {
  if (sectionIndex.value !== saved.sectionIndex) {
    await goToSection(saved.sectionIndex)
  }
  await waitForActiveSection(saved.sectionIndex)
  alignTtsSessionWithProgress(saved)
}

function measureTtsToolbarHeight(): number {
  const toolbar = ttsToolbarRef.value?.$el
  if (!(toolbar instanceof HTMLElement)) return 0
  return Math.ceil(toolbar.getBoundingClientRect().height)
}

function updateReaderBottomChromeHeight() {
  const shell = readerShellRef.value
  if (!shell) return

  const height = measureTtsToolbarHeight()
  if (height > 0) {
    shell.style.setProperty('--reader-tts-toolbar-height', `${height}px`)
  } else {
    shell.style.removeProperty('--reader-tts-toolbar-height')
  }
}

function refreshReaderLayout() {
  updateReaderBottomChromeHeight()
  window.dispatchEvent(new Event('resize'))
  if (tts.isActive.value) {
    tts.refreshTtsHighlight()
  }
}

function attachTtsToolbarResizeObserver() {
  ttsToolbarResizeObserver?.disconnect()
  ttsToolbarResizeObserver = null

  const toolbar = ttsToolbarRef.value?.$el
  if (!(toolbar instanceof HTMLElement)) return

  ttsToolbarResizeObserver = new ResizeObserver(() => {
    refreshReaderLayout()
  })
  ttsToolbarResizeObserver.observe(toolbar)
}

const tts = useEpubTts({
  fileId,
  getDocument: () => getActiveDocument(),
  getSettings: () => effectiveEpubSettings.value,
  bookLanguage,
  getChapterTitle: () => chapterTitle.value,
  getResumeKey: () => `${fileId}:${sectionIndex.value}`,
  getCurrentSectionIndex: () => sectionIndex.value,
  getPersistedTtsPosition: () => progress.getTtsPosition(),
  onTtsWordIndexChange: (wordIndex) => progress.updateTtsPosition(sectionIndex.value, wordIndex),
  onTtsCheckpoint: () => {
    void progress.flush()
  },
  onSectionComplete: () => {
    void handleTtsSectionComplete()
  },
  getFoliateRenderer: () => {
    const renderer = getRenderer() as {
      scrolled?: boolean
      size?: number
      start?: number
      scrollProp?: string
      scrollBy?: (dx: number, dy: number) => void
      scrollToAnchor?: (anchor: Range | Element, select?: boolean) => Promise<void>
    } | null
    if (!renderer) return null
    // Foliate: vertical paginated uses scrollTop; vertical scrolled uses scrollLeft.
    // Use live getters for size/start/scrolled — pinWordRangeAsViewportLead reads
    // start *after* scrollToAnchor; a one-shot snapshot is stale and fine-tunes the wrong way.
    const scrollProp = renderer.scrollProp
    return {
      get scrolled() {
        return Boolean(renderer.scrolled)
      },
      get size() {
        return renderer.size
      },
      get start() {
        return renderer.start
      },
      get vertical() {
        const scrolled = Boolean(renderer.scrolled)
        return typeof scrollProp === 'string'
          ? scrolled
            ? scrollProp === 'scrollLeft'
            : scrollProp === 'scrollTop'
          : false
      },
      scrollBy: renderer.scrollBy?.bind(renderer),
      scrollToAnchor: renderer.scrollToAnchor?.bind(renderer),
    }
  },
})
handleLoadedDocument = tts.handleDocumentLoad

const ttsStatus = computed(() => tts.status.value)
const ttsProgress = computed(() => tts.progress.value)
const ttsActiveIndex = computed(() => tts.activeIndex.value)
const ttsWordCount = computed(() => tts.wordCount.value)
const ttsCurrentProvider = computed(() => tts.currentProvider.value)
const isLeavingReader = ref(false)
const ttsIsActive = computed(() => tts.isActive.value && !isLeavingReader.value)
const ttsFollowTarget = computed(() => tts.followTarget.value)
const ttsFollowTargetOffViewport = computed(() => tts.followTargetOffViewport.value)
const ttsFollowTargetAway = computed(() => {
  const target = ttsFollowTarget.value
  return Boolean(target && target.sectionIndex !== sectionIndex.value)
})
const showTtsFollowAlong = computed(() => {
  if (!ttsIsActive.value || ttsStatus.value === 'error') return false
  // Show whenever the spoken word is not on the current paginated page / scrolled viewport,
  // or when the user is in a different spine section than the TTS word.
  return ttsFollowTargetAway.value || ttsFollowTargetOffViewport.value
})

watch(ttsIsActive, async (active) => {
  await nextTick()
  if (active) {
    attachTtsToolbarResizeObserver()
  } else {
    ttsToolbarResizeObserver?.disconnect()
    ttsToolbarResizeObserver = null
  }
  requestAnimationFrame(() => {
    refreshReaderLayout()
  })
})

setTextSelectedHandler(selection.show)

onMounted(async () => {
  const onFullscreenChange = () => {
    isFullscreen.value = !!document.fullscreenElement
  }
  document.addEventListener('fullscreenchange', onFullscreenChange)
  onUnmounted(() => {
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    ttsToolbarResizeObserver?.disconnect()
    ttsToolbarResizeObserver = null
  })

  // Specialized readers own their own progress/settings/loading lifecycle.
  if (isAudioFormat || isPdfFormat || isComicFormat) return

  await customFonts.fetchFonts()
  setFontFaceCSS(customFonts.generateFontFaceCSS())

  await progress.load()
  // Snapshot restore targets before open so intermediate Foliate relocates cannot
  // clobber the page we intend to reopen.
  const restoreCfi = progress.cfi.value
  const restoreFraction = progress.percentage.value > 0 ? progress.percentage.value / 100 : undefined
  const restoreSectionFraction = progress.sectionFraction.value
  const restoreTtsPosition = progress.getTtsPosition()
  const pendingTtsSession = readTtsPlaybackSession(fileId)
  const shouldRestoreTtsToolbar = Boolean(pendingTtsSession?.enabled)
  if (shouldRestoreTtsToolbar) {
    alignTtsSessionWithProgress(restoreTtsPosition ?? undefined)
  }

  await bookSettings.load()
  void tts.warmUp()
  const effective = bookSettings.effective.value as EpubReaderSettings
  if (effective.footerDisplayMode !== undefined) {
    footerMode.value = effective.footerDisplayMode
  }
  if (effective.overrideBookFormatting) {
    shouldApplyStyles.value = true
    seedState(effective)
  } else if (bookSettings.isCustomized.value) {
    shouldApplyStyles.value = true
    seedState(bookSettings.bookDelta.value as Partial<ReaderState>)
  } else {
    shouldApplyStyles.value = false
  }

  const cachedProgress = readCachedReaderProgress(fileId)
  const hadProgress = progress.percentage.value > 0 || Boolean(restoreCfi) || cachedProgress !== null

  // 1) Restore TTS chrome first so pagination/scroll geometry matches last session.
  if (shouldRestoreTtsToolbar) {
    await settleTtsChromeLayout()
  }

  // 2) Only after chrome is settled, restore the exact previous page.
  await open(bookId, fileId, fileFormat, restoreCfi, restoreFraction, {
    hasCachedProgress: hadProgress,
    fixedLayoutSpread: state.value.fixedLayoutSpread,
    sectionFraction: restoreSectionFraction,
  })
  setChapters(getChapters())
  sectionFractions.value = getSectionFractions()

  await waitForInitialRestore()

  // Re-apply the snapshot after toolbar reflow so we do not land on a chapter-start
  // intermediate page that Foliate may have emitted during open.
  if (restoreCfi) {
    await goTo(restoreCfi)
  } else if (restoreFraction !== undefined && restoreFraction > 0) {
    await goToFraction(restoreFraction)
  }

  // Paginated EPUB: CFI alone can still land one visual page early (boundary glyphs /
  // multi-page blocks). Re-snap with the saved section page fraction after CFI loads
  // the correct spine section.
  if (restoreSectionFraction != null && Number.isFinite(restoreSectionFraction)) {
    const renderer = getRenderer() as FoliateRenderer | null
    if (renderer && renderer.scrolled !== true && typeof renderer.scrollToAnchor === 'function') {
      await renderer.scrollToAnchor(restoreSectionFraction).catch(() => {})
    }
  }

  // Persist the settled exact page/scroll once (saves were suppressed during open).
  if (hadProgress && (progress.cfi.value || progress.percentage.value > 0)) {
    void progress.save().catch(() => {})
  }

  // 3) Finish TTS mode: highlight/resume on the restored page without jumping away
  // unless auto-resume needs the saved TTS section (playing across sections).
  if (shouldRestoreTtsToolbar) {
    const sectionBeforeTts = sectionIndex.value
    const savedTts = restoreTtsPosition ?? progress.getTtsPosition()
    if (savedTts && pendingTtsSession?.wasPlaying && savedTts.sectionIndex !== sectionIndex.value) {
      await ensureReaderAtTtsPosition(savedTts)
    }
    alignTtsSessionWithProgress(savedTts ?? undefined)
    const ttsRestoreResult = await tts.restoreTtsAfterReload()
    if (ttsRestoreResult === 'resumed') {
      toast.info('Resumed read aloud', { duration: 2500 })
    } else if (tts.isActive.value) {
      await nextTick()
      attachTtsToolbarResizeObserver()
      refreshReaderLayout()
      tts.refreshTtsHighlight()
    }

    // TTS highlight restore / residual auto-resume must not leave us on the wrong
    // page or the next spine section. Re-snap to the pre-TTS reading position when
    // we are still on the same section the book opened to.
    if (sectionIndex.value === sectionBeforeTts) {
      if (restoreCfi) {
        await goTo(restoreCfi).catch(() => {})
      }
      if (restoreSectionFraction != null && Number.isFinite(restoreSectionFraction)) {
        const renderer = getRenderer() as FoliateRenderer | null
        if (renderer && renderer.scrolled !== true && typeof renderer.scrollToAnchor === 'function') {
          await renderer.scrollToAnchor(restoreSectionFraction).catch(() => {})
        }
      }
      if (tts.isActive.value) {
        tts.restoreTtsHighlightNow()
      }
    }
  }

  await bookmarks.load(bookId)
  await annotations.load(bookId)
  if (annotations.annotations.value.length > 0) {
    addAnnotations(annotations.annotations.value.map((a) => ({ cfi: a.cfi, color: a.color, style: a.style })))
    if (tts.isActive.value) {
      await nextTick()
      tts.refreshTtsHighlight()
    }
  }

  if (hadProgress && !shouldRestoreTtsToolbar) {
    const pct = Math.round(progress.percentage.value)
    const label = chapterTitle.value || `Chapter ${sectionIndex.value + 1}`
    toast.info(`Resumed at ${pct}% - ${label}`, { duration: 2500 })
  }
})

const epubSetters: Record<string, (v: unknown) => void> = {
  fontSize: (v) => setFontSize(v as number),
  lineHeight: (v) => setLineHeight(v as number),
  fontFamily: (v) => setFontFamily(v as string | null),
  maxColumnCount: (v) => setMaxColumnCount(v as number),
  gap: (v) => setGap(v as number),
  maxInlineSize: (v) => setMaxInlineSize(v as number),
  maxBlockSize: (v) => setMaxBlockSize(v as number),
  justify: (v) => setJustify(v as boolean),
  hyphenate: (v) => setHyphenate(v as boolean),
  isDark: (v) => setIsDark(v as boolean),
  themeName: (v) => setThemeName(v as string),
  flow: (v) => setFlow(v as 'paginated' | 'scrolled'),
  fixedLayoutSpread: (v) => setFixedLayoutSpread(v as EpubReaderSettings['fixedLayoutSpread']),
}

// Applies settings to reactive refs (and renderer if open) without touching the delta.
// Used for initial seeding on mount.
function seedState(partial: Partial<ReaderState>) {
  for (const [key, value] of Object.entries(partial)) {
    epubSetters[key]?.(value)
  }
  const renderer = getRenderer()
  if (renderer) applyToRenderer(renderer)
}

// Applies a user-initiated change: updates reactive refs AND saves the changed field to delta.
// Also enables style injection from this point forward (user has opted in by changing something).
async function applyUpdate(partial: Partial<ReaderState>) {
  const shouldReopenForSpread =
    partial.fixedLayoutSpread !== undefined && partial.fixedLayoutSpread !== state.value.fixedLayoutSpread
  shouldApplyStyles.value = true
  seedState(partial)

  if ('themeName' in partial && partial.themeName) {
    bookSettings.updateGlobalSettings(buildThemeSwitchHighlightPatch(effectiveEpubSettings.value, partial.themeName) as Partial<ReaderState>)
  } else {
    bookSettings.updateGlobalSettings(partial)
  }

  if (shouldReopenForSpread) {
    const fallbackFraction =
      fraction.value > 0 ? fraction.value : progress.percentage.value > 0 ? progress.percentage.value / 100 : undefined
    await open(bookId, fileId, fileFormat, null, fallbackFraction, {
      fixedLayoutSpread: state.value.fixedLayoutSpread,
    })
    sectionFractions.value = getSectionFractions()
  }
}

provide(epubReaderUiKey, {
  state,
  applyUpdate,
})

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.()
  } else {
    document.documentElement.requestFullscreen?.()
  }
}

watch(
  () => footerMode.value,
  (mode) => {
    bookSettings.updateBookSettings({ footerDisplayMode: mode })
    const renderer = getRenderer()
    if (renderer) {
      updateHeadsFeet(renderer, activeMode.value)
    }
  },
)

function setSettingsOpen(open: boolean) {
  showSettings.value = open
}

watch([showSettings, showTtsSettings], ([settingsOpen, ttsSettingsOpen]) => {
  setVisibilityLock(settingsOpen || ttsSettingsOpen)
})

watch(
  () => tts.error.value,
  (message) => {
    if (message) toast.error(message)
  },
)

const TTS_SETTINGS_PATCH_KEYS = [
  'ttsProvider',
  'ttsVoice',
  'ttsRate',
  'ttsPitch',
  'ttsVolume',
  'ttsGcpChirp3Voice',
  'ttsAzureVoice',
  'ttsXaiVoice',
  'ttsKokoroVoice',
  'ttsGpt4oMiniVoice',
] as const satisfies readonly (keyof EpubReaderSettings)[]

function applyTtsUpdate(patch: Partial<EpubReaderSettings>) {
  if ('ttsSentenceHighlightColor' in patch || 'ttsWordHighlightColor' in patch) {
    bookSettings.updateGlobalSettings(buildThemeHighlightPatch(effectiveEpubSettings.value, patch) as Partial<EpubReaderSettings>)
    return
  }

  bookSettings.updateGlobalSettings(patch)

  if (TTS_SETTINGS_PATCH_KEYS.some((key) => key in patch)) {
    tts.applyTtsSettingsChange()
  }
}

function openTtsColorPicker(target: 'sentence' | 'word') {
  showTtsSettings.value = false
  ttsColorPickerTarget.value = target
}

function closeTtsColorPicker() {
  ttsColorPickerTarget.value = null
}

async function handleTtsSectionComplete() {
  if (ttsAutoAdvancing.value) return
  if (sectionIndex.value >= totalSections.value - 1) return

  ttsAutoAdvancing.value = true
  try {
    const nextSection = sectionIndex.value + 1
    progress.updateTtsPosition(nextSection, 0)
    await goToSection(nextSection)
    await nextTick()
    await tts.start(0, { userInitiated: false })
  } finally {
    ttsAutoAdvancing.value = false
  }
}

function formatSectionLabel(index: number, title?: string): string {
  return title?.trim() || `Section ${index + 1}`
}

const ttsResumeSavedLabel = computed(() => {
  const saved = pendingTtsResume.value
  if (!saved) return ''
  if (saved.sectionIndex === sectionIndex.value) return 'your last position'
  return formatSectionLabel(saved.sectionIndex)
})

const ttsResumeCurrentLabel = computed(() => {
  const saved = pendingTtsResume.value
  if (saved && saved.sectionIndex === sectionIndex.value) return 'this page'
  return formatSectionLabel(sectionIndex.value, chapterTitle.value)
})

const ttsResumeSameView = computed(() => {
  const saved = pendingTtsResume.value
  return Boolean(saved && saved.sectionIndex === sectionIndex.value)
})

/**
 * Wait for content-area height to reflow after TTS chrome appears or disappears.
 * `.reader-content-area` uses a 300ms bottom transition — must wait past that or the
 * final column layout (and our re-anchor) race mid-animation.
 */
async function waitForTtsChromeLayoutSettle() {
  await nextTick()
  refreshReaderLayout()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
  // Match main.css `.reader-content-area { transition: bottom 300ms }` + a frame for
  // Foliate's ResizeObserver → expand → columnize to finish after the height sticks.
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 360)
  })
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

/**
 * Pin Foliate to the first on-screen word, run a chrome change, then re-pin after reflow.
 * Used when the TTS toolbar appears or disappears so page breaks don't drift.
 */
async function withViewportWordAnchor(runChromeChange: () => void | Promise<void>) {
  const layoutAnchorWordIndex = await tts.anchorViewportToFirstVisibleWord()
  await runChromeChange()
  await waitForTtsChromeLayoutSettle()
  if (layoutAnchorWordIndex !== null) {
    // Re-pin with lead fine-tune after height has fully settled (fresh Range).
    await tts.anchorViewportToWord(layoutAnchorWordIndex)
  }
}

/** Show the TTS toolbar and wait for content-area height to reflow (reload restore + play entry). */
async function settleTtsChromeLayout() {
  // Before chrome appears: pin Foliate's layout anchor to the first on-screen word.
  // The toolbar shrinks the content area and re-paginates; with this anchor set first,
  // Foliate's resize/expand path keeps that word as the page start instead of drifting.
  await withViewportWordAnchor(async () => {
    tts.prepareUi()
    await nextTick()
    attachTtsToolbarResizeObserver()
  })
}

/** Hide the TTS toolbar while keeping the first on-screen word as the layout anchor. */
async function dismissTtsChromeLayout(stopOptions?: { checkpoint?: boolean }) {
  // Before chrome leaves: pin the first visible word so expanding the content area
  // re-paginates around that word instead of jumping the reading position.
  await withViewportWordAnchor(() => {
    tts.stop(stopOptions)
    showTtsSettings.value = false
    ttsColorPickerTarget.value = null
    ttsToolbarResizeObserver?.disconnect()
    ttsToolbarResizeObserver = null
  })
}

function remindTapToStartReading() {
  toast.info('Tap anywhere on the page to start reading from that sentence.', { duration: 4500 })
}

function cancelTtsResumeDialog() {
  showTtsResumeDialog.value = false
  pendingTtsResume.value = null
  // Chrome may already be open from layout settle; dismiss if nothing is playing.
  if (tts.status.value === 'idle' || tts.status.value === 'done' || tts.status.value === 'error') {
    void dismissTtsChromeLayout({ checkpoint: false })
  }
}

async function resumeTtsAtSavedPosition() {
  const saved = pendingTtsResume.value
  showTtsResumeDialog.value = false
  pendingTtsResume.value = null
  if (!saved) return

  await ensureReaderAtTtsPosition(saved)
  await tts.start(saved.wordIndex)
}

/** Stay on this page: enable TTS and wait for a tap to pick the starting sentence. */
async function startTtsFromHereAwaitingTap() {
  showTtsResumeDialog.value = false
  pendingTtsResume.value = null
  await settleTtsChromeLayout()
  remindTapToStartReading()
}

/**
 * Speaker / play entry point.
 * - Last-read page still in view → resume from that word.
 * - Any other page with a saved position → prompt resume vs read from here.
 * - No saved position → enable TTS only; tap a sentence to start.
 */
async function startTtsFromSavedProgress() {
  try {
    await progress.flush()
  } catch {
    // Continue with the last known snapshot if the flush fails.
  }
  await progress.refreshFromServer()

  const saved = progress.getTtsPosition()
  // Reserve chrome first so viewport metrics match the TTS layout.
  await settleTtsChromeLayout()

  if (saved) {
    const savedWordVisibleInViewport =
      saved.sectionIndex === sectionIndex.value ? tts.isWordVisibleInViewport(saved.wordIndex) : false
    const awayFromLastRead = isAwayFromLastTtsPosition({
      savedSectionIndex: saved.sectionIndex,
      currentSectionIndex: sectionIndex.value,
      savedWordVisibleInViewport,
    })
    if (awayFromLastRead) {
      pendingTtsResume.value = saved
      showTtsResumeDialog.value = true
      return
    }
    await tts.start(saved.wordIndex, { userInitiated: true, preserveViewport: true })
    return
  }

  // No prior TTS position — enable and wait for tap.
  remindTapToStartReading()
}

async function startTtsPlayback() {
  if (tts.status.value === 'paused') {
    await resumeTtsPlayback()
    return
  }

  if (tts.status.value === 'loading') {
    tts.stop({ checkpoint: false })
  }

  // Already enabled and idle: play button resumes last position only if it is still in view;
  // otherwise stay idle so the user can tap a sentence on this page.
  if (tts.isActive.value && (tts.status.value === 'idle' || tts.status.value === 'done' || tts.status.value === 'error')) {
    const saved = progress.getTtsPosition()
    if (saved && saved.sectionIndex === sectionIndex.value && tts.isWordVisibleInViewport(saved.wordIndex)) {
      await tts.start(saved.wordIndex, { userInitiated: true, preserveViewport: true })
      return
    }
    // Not on last-read page — remind and wait for a page tap.
    if (!showTtsResumeDialog.value) {
      remindTapToStartReading()
    }
    return
  }

  await startTtsFromSavedProgress()
}

async function followTtsPosition() {
  const target = ttsFollowTarget.value ?? progress.getTtsPosition()
  // Jump to the TTS section when needed, rebuild the highlight, then scroll/page
  // exactly to the spoken word (paginated page turn or scrolled keep-in-view).
  if (target && target.sectionIndex !== sectionIndex.value) {
    await ensureReaderAtTtsPosition(target)
    await nextTick()
  }
  tts.restoreTtsHighlightNow()
  await nextTick()
  tts.resumeScrollFollow()
  // Layout may still be settling after a section change — re-jump once more.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
  tts.resumeScrollFollow()
}

async function resumeTtsPlayback() {
  const target = ttsFollowTarget.value
  if (target && target.sectionIndex !== sectionIndex.value) {
    await followTtsPosition()
  }
  tts.resume()
}

function toggleTts() {
  if (tts.isActive.value) {
    void dismissTtsChromeLayout()
    return
  }
  selection.dismiss()
  void startTtsPlayback()
}

watch(
  () => customFonts.fonts.value,
  () => {
    setFontFaceCSS(customFonts.generateFontFaceCSS())
    const renderer = getRenderer()
    if (renderer && shouldApplyStyles.value) applyToRenderer(renderer)
  },
)

async function handleHighlight(color: string, style: string, note?: string) {
  const annotationCfi = selection.cfi.value
  if (!selection.text.value || !annotationCfi) return
  const created = await annotations.create(bookId, {
    cfi: annotationCfi,
    text: selection.text.value,
    color,
    style,
    note: note ?? null,
    chapterTitle: chapterTitle.value || null,
  })
  if (created) {
    addAnnotation(created.cfi, created.color, created.style)
  }
  selection.dismiss()
}

async function handleSaveNote(note: string) {
  await handleHighlight('#FACC15', 'highlight', note)
  selection.showNoteDialog.value = false
  selection.noteText.value = ''
}

function handleDeleteAnnotation(id: number) {
  const ann = annotations.annotations.value.find((a) => a.id === id)
  if (ann) {
    deleteAnnotation(ann.cfi)
    annotations.remove(bookId, id)
  }
  selection.dismiss()
}

function handleSidebarDeleteAnnotation(id: number) {
  const ann = annotations.annotations.value.find((a) => a.id === id)
  if (ann) {
    deleteAnnotation(ann.cfi)
    annotations.remove(bookId, id)
  }
}

function onSearchQuery(q: string) {
  if (!foliateView.value) return
  doSearch(foliateView.value as FoliateView, q)
}

async function openSearchWithText(text: string) {
  selection.dismiss()
  searchInitialQuery.value = text
  showSearch.value = true
  await nextTick()
  onSearchQuery(text)
}

function onSearchClear() {
  clearSearch(foliateView.value as FoliateView | null)
}

function navigateSearch(cfiTarget: string) {
  goTo(cfiTarget)
}

async function handleBack() {
  await leaveReader(router, {
    onLeaving: () => {
      if (!isAudioFormat && !isPdfFormat && !isComicFormat) {
        isLeavingReader.value = true
      }
    },
  })
}

onBeforeRouteLeave(async () => {
  if (isAudioFormat || isPdfFormat || isComicFormat) return true
  isLeavingReader.value = true
  const savedTts = ttsFollowTarget.value ?? progress.getTtsPosition()
  tts.persistForNavigation({
    sectionIndex: savedTts?.sectionIndex ?? sectionIndex.value,
    wordIndex: savedTts?.wordIndex,
  })
  await progress.flush()
  return true
})

function closeSearch() {
  onSearchClear()
  searchInitialQuery.value = ''
  showSearch.value = false
}
</script>

<template>
  <PdfV4ReaderView v-if="isPdfFormat" :bookId="bookId" :fileId="fileId" />
  <CbzReaderView v-else-if="isComicFormat" :bookId="bookId" :fileId="fileId" />
  <AudiobookReaderView v-else-if="isAudioFormat" :bookId="bookId" :fileId="fileId" />
  <div
    v-else
    ref="readerShellRef"
    class="reader-shell fixed inset-0 overflow-hidden"
    :class="{ 'reader-tts-active': ttsIsActive }"
    :style="
      shouldApplyStyles ? { background: activeMode.bg, colorScheme: isDark ? 'dark' : 'light' } : { background: '#ffffff', colorScheme: 'light' }
    "
  >
    <ReaderHeader
      :chapterTitle="chapterTitle"
      :isBookmarked="bookmarks.isCurrentCfiBookmarked.value"
      :settings-open="showSettings"
      :footerMode="footerMode"
      :tts-active="ttsIsActive"
      class="transition-all duration-300"
      :class="headerVisible || ttsIsActive ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'"
      @back="handleBack()"
      @toggleSidebar="showSidebar = !showSidebar"
      @toggleSearch="showSearch = !showSearch"
      @toggleBookmark="bookmarks.toggle(bookId, cfi ?? '', chapterTitle)"
      @toggleTts="toggleTts"
      @update:settings-open="setSettingsOpen"
      @toggleFullscreen="toggleFullscreen"
      @toggleHelp="toggleHelpModal"
      @cycleFooterMode="cycleFooterMode"
    >
      <template #settingsPanel>
        <ReaderSettingsPanel :state="state" :customFonts="customFonts" @update="applyUpdate" />
      </template>
    </ReaderHeader>

    <Transition name="bookmark-fade">
      <div v-if="bookmarks.isCurrentCfiBookmarked.value" class="absolute left-8 z-30 pointer-events-none" aria-hidden="true">
        <div class="w-7 h-14 bg-primary" style="clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%)" />
      </div>
    </Transition>

    <div class="reader-content-area absolute inset-x-0 top-0">
      <div v-if="loading || restoring" class="absolute inset-0 flex items-center justify-center z-10 bg-background">
        <div class="flex flex-col items-center gap-3">
          <div class="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p class="text-sm text-muted-foreground">{{ restoring ? 'Restoring reader…' : 'Loading book…' }}</p>
        </div>
      </div>

      <div v-if="error && !loading" class="absolute inset-0 flex items-center justify-center z-10 p-8 bg-background">
        <div class="text-center max-w-sm">
          <p class="text-sm font-medium mb-2 text-foreground">Failed to load book</p>
          <p class="text-xs text-muted-foreground">{{ error }}</p>
        </div>
      </div>

      <div ref="containerRef" class="absolute inset-0" />
    </div>

    <ReaderFooter
      v-if="!ttsIsActive"
      :fraction="fraction"
      :sectionIndex="sectionIndex"
      :totalSections="totalSections"
      :sectionFractions="sectionFractions"
      :chapterStartFraction="chapterStartFraction"
      :chapterEndFraction="chapterEndFraction"
      :locationTotal="locationTotal"
      :seekBookmark="seekBookmark"
      class="transition-all duration-300"
      :class="footerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full pointer-events-none'"
      @prevSection="goToSection(sectionIndex - 1)"
      @nextSection="goToSection(sectionIndex + 1)"
      @seek="handleSeek($event)"
      @seekBookmarkTap="handleSeekBookmarkTap"
    />

    <TtsFollowAlongButton :visible="showTtsFollowAlong" @resume="followTtsPosition" />

    <TtsControls
      v-if="ttsIsActive"
      ref="ttsToolbarRef"
      :status="ttsStatus"
      :progress="ttsProgress"
      :activeIndex="ttsActiveIndex"
      :wordCount="ttsWordCount"
      :provider="ttsCurrentProvider"
      :settings="effectiveEpubSettings"
      @start="startTtsPlayback"
      @prefetch="void tts.prefetchPlaybackAhead()"
      @pause="tts.pause"
      @resume="resumeTtsPlayback"
      @replay="tts.replay"
      @skipBack="tts.skipBackward"
      @skipForward="tts.skipForward"
      @toggleSettings="showTtsSettings = true"
      @updateProvider="(provider) => applyTtsUpdate({ ttsProvider: provider })"
      @updateRate="(rate) => applyTtsUpdate({ ttsRate: rate })"
    />

    <TtsSettingsPanel
      v-if="showTtsSettings"
      :settings="effectiveEpubSettings"
      @update="applyTtsUpdate"
      @pickColor="openTtsColorPicker"
      @close="showTtsSettings = false"
    />

    <TtsHighlightColorPanel
      v-if="ttsColorPickerTarget"
      :target="ttsColorPickerTarget"
      :sentenceColor="effectiveEpubSettings.ttsSentenceHighlightColor"
      :wordColor="effectiveEpubSettings.ttsWordHighlightColor"
      @update:target="ttsColorPickerTarget = $event"
      @update="applyTtsUpdate"
      @close="closeTtsColorPicker"
    />

    <ReaderSidebar
      v-if="showSidebar"
      :chapters="chapters"
      :bookmarks="bookmarks.bookmarks.value"
      :annotations="annotations.annotations.value"
      :activeHref="activeHref"
      :expandedHrefs="expandedHrefs"
      @close="showSidebar = false"
      @navigateChapter="
        (href) => {
          goTo(href)
          showSidebar = false
        }
      "
      @deleteBookmark="(id) => bookmarks.remove(bookId, id)"
      @deleteAnnotation="handleSidebarDeleteAnnotation"
      @toggleExpand="toggleExpand"
    />

    <ReaderSearchPanel
      v-if="showSearch"
      :results="searchResults"
      :isSearching="isSearching"
      :initialQuery="searchInitialQuery"
      @search="onSearchQuery"
      @clear="onSearchClear"
      @navigate="navigateSearch($event)"
      @close="closeSearch"
    />

    <NoteDialog
      v-if="selection.showNoteDialog.value"
      :selectedText="selection.text.value"
      :modelValue="selection.noteText.value"
      @update:modelValue="selection.noteText.value = $event"
      @save="handleSaveNote"
      @cancel="selection.showNoteDialog.value = false"
    />

    <SelectionPopup
      :visible="selection.visible.value"
      :position="selection.position.value"
      :showBelow="selection.showBelow.value"
      :selectedText="selection.text.value"
      :overlappingAnnotationId="selection.overlappingAnnotationId.value"
      @copy="selection.dismiss()"
      @highlight="handleHighlight"
      @search="() => openSearchWithText(selection.text.value)"
      @translate="handleTranslate"
      @define="handleDefine"
      @note="selection.openNoteDialog()"
      @deleteAnnotation="handleDeleteAnnotation"
      @dismiss="selection.dismiss()"
    />

    <DictionaryPopover
      v-if="showDictionary"
      :word="dictionaryWord"
      :position="dictionaryPosition"
      :lang="bookLanguage"
      @close="showDictionary = false"
    />

    <TranslationPopover
      v-if="showTranslation && !isMobile"
      :text="translationText"
      :position="translationPosition"
      @close="showTranslation = false"
    />

    <TranslationSheet v-if="showTranslation && isMobile" :text="translationText" @close="showTranslation = false" />

    <KeyboardShortcutsModal v-if="showHelpModal" @close="showHelpModal = false" />

    <TtsResumeDialog
      v-if="showTtsResumeDialog && pendingTtsResume"
      :savedSectionLabel="ttsResumeSavedLabel"
      :currentSectionLabel="ttsResumeCurrentLabel"
      :sameViewSection="ttsResumeSameView"
      @continueSaved="resumeTtsAtSavedPosition"
      @startHere="startTtsFromHereAwaitingTap"
      @cancel="cancelTtsResumeDialog"
    />
  </div>
</template>

<style scoped>
.bookmark-fade-enter-active,
.bookmark-fade-leave-active {
  transition: opacity 0.2s ease;
}
.bookmark-fade-enter-from,
.bookmark-fade-leave-to {
  opacity: 0;
}
</style>
