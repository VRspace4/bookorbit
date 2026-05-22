<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useFoliate, type RelocateDetail } from './epub/composables/useFoliate'
import { useReaderProgress } from './shared/composables/useReaderProgress'
import { useReadingSession } from './shared/composables/useReadingSession'
import { exitReader } from './shared/lib/reader-navigation'
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
import type { ReaderState } from './epub/composables/useReaderState'
import type { FoliateRenderer } from './epub/composables/useFoliate'
import type { EpubReaderSettings } from '@bookorbit/types'
import { getFormatGroup } from '@bookorbit/types'
import { buildThemeHighlightPatch, buildThemeSwitchHighlightPatch } from './epub/theme-highlight'
import { readCachedReaderProgress } from './shared/lib/reader-progress-cache'
import { readTtsPlaybackSession, writeTtsPlaybackSession } from './epub/tts/tts-session-cache'

const route = useRoute()
const router = useRouter()
const bookId = Number(route.params.bookId)
const fileId = Number(route.params.fileId)
const fileFormat = (route.query.format as string) || 'epub'
const isAudioFormat = getFormatGroup(fileFormat) === 'audio'
const isPdfFormat = fileFormat === 'pdf'
const isComicFormat = fileFormat === 'cbz' || fileFormat === 'cbr' || fileFormat === 'cb7'

const containerRef = ref<HTMLElement | null>(null)
const showSidebar = ref(false)
const showSettings = ref(false)
const showSearch = ref(false)
const showTtsSettings = ref(false)
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
} = readerState

const customFonts = useCustomFonts()

const { onActivity, elapsedMinutes } = useReadingSession(fileId, () => ({
  percentage: progress.percentage.value,
  cfi: progress.cfi.value,
  pageNumber: progress.pageNumber.value,
}))

const progress = useReaderProgress(bookId, fileId, elapsedMinutes)
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
  progress.onRelocate(detail)
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

function alignTtsSessionWithProgress() {
  const saved = progress.getTtsPosition()
  if (!saved) return
  const session = readTtsPlaybackSession(fileId)
  if (!session?.enabled) return
  writeTtsPlaybackSession(fileId, {
    enabled: true,
    wasPlaying: false,
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
  alignTtsSessionWithProgress()
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
      scrollBy?: (dx: number, dy: number) => void
    } | null
    return renderer
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
const ttsScrollFollowEnabled = computed(() => tts.scrollFollowEnabled.value)
const showTtsFollowAlong = computed(
  () => ttsIsActive.value && !ttsScrollFollowEnabled.value && ttsStatus.value !== 'idle' && ttsStatus.value !== 'done' && ttsStatus.value !== 'error',
)

setTextSelectedHandler(selection.show)

onMounted(async () => {
  const onFullscreenChange = () => {
    isFullscreen.value = !!document.fullscreenElement
  }
  document.addEventListener('fullscreenchange', onFullscreenChange)
  onUnmounted(() => document.removeEventListener('fullscreenchange', onFullscreenChange))

  // Specialized readers own their own progress/settings/loading lifecycle.
  if (isAudioFormat || isPdfFormat || isComicFormat) return

  await customFonts.fetchFonts()
  setFontFaceCSS(customFonts.generateFontFaceCSS())

  await progress.load()
  alignTtsSessionWithProgress()

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
  const hadProgress = progress.percentage.value > 0 || cachedProgress !== null
  await open(bookId, fileId, fileFormat, progress.cfi.value, hadProgress ? progress.percentage.value / 100 : undefined, {
    hasCachedProgress: hadProgress,
  })
  setChapters(getChapters())
  sectionFractions.value = getSectionFractions()

  await waitForInitialRestore()

  const ttsSession = readTtsPlaybackSession(fileId)
  const savedTts = progress.getTtsPosition()
  if (ttsSession?.enabled && savedTts) {
    alignTtsSessionWithProgress()
    await ensureReaderAtTtsPosition(savedTts)
  }

  const ttsRestoreResult = await tts.restoreTtsAfterReload()
  if (ttsRestoreResult === 'resumed') {
    toast.info('Resumed read aloud', { duration: 2500 })
  }

  if (tts.isActive.value) {
    await nextTick()
    tts.refreshTtsHighlight()
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

  if (hadProgress && !readTtsPlaybackSession(fileId)?.enabled) {
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
function applyUpdate(partial: Partial<ReaderState>) {
  shouldApplyStyles.value = true
  seedState(partial)

  if ('themeName' in partial && partial.themeName) {
    bookSettings.updateGlobalSettings(buildThemeSwitchHighlightPatch(effectiveEpubSettings.value, partial.themeName) as Partial<ReaderState>)
    return
  }

  bookSettings.updateGlobalSettings(partial)
}

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
  return formatSectionLabel(saved.sectionIndex)
})

const ttsResumeCurrentLabel = computed(() => formatSectionLabel(sectionIndex.value, chapterTitle.value))

function cancelTtsResumeDialog() {
  showTtsResumeDialog.value = false
  pendingTtsResume.value = null
}

async function resumeTtsAtSavedPosition() {
  const saved = pendingTtsResume.value
  showTtsResumeDialog.value = false
  pendingTtsResume.value = null
  if (!saved) return

  await ensureReaderAtTtsPosition(saved)
  await tts.start(saved.wordIndex)
}

async function startTtsFromCurrentSection() {
  showTtsResumeDialog.value = false
  pendingTtsResume.value = null
  progress.updateTtsPosition(sectionIndex.value, 0)
  await tts.start(0)
}

async function startTtsFromSavedProgress() {
  try {
    await progress.flush()
  } catch {
    // Continue with the last known snapshot if the flush fails.
  }
  await progress.refreshFromServer()

  const saved = progress.getTtsPosition()
  if (saved) {
    await ensureReaderAtTtsPosition(saved)
    await tts.start(saved.wordIndex)
    return
  }

  await tts.start(0)
}

async function startTtsPlayback() {
  if (tts.status.value === 'paused') {
    tts.resume()
    return
  }

  if (tts.status.value === 'loading') {
    tts.stop({ checkpoint: false })
  }

  await startTtsFromSavedProgress()
}

function toggleTts() {
  if (tts.isActive.value) {
    tts.stop()
    showTtsSettings.value = false
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
  if (!isAudioFormat && !isPdfFormat && !isComicFormat) {
    isLeavingReader.value = true
  }
  await progress.flush()
  await exitReader(router)
}

onBeforeRouteLeave(async () => {
  if (isAudioFormat || isPdfFormat || isComicFormat) return true
  isLeavingReader.value = true
  const savedTts = progress.getTtsPosition()
  tts.persistForNavigation({
    sectionIndex: sectionIndex.value,
    wordIndex: savedTts?.sectionIndex === sectionIndex.value ? savedTts.wordIndex : undefined,
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
    class="fixed inset-0 overflow-hidden"
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

    <div class="absolute inset-0">
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

    <TtsFollowAlongButton :visible="showTtsFollowAlong" @resume="tts.resumeScrollFollow" />

    <TtsControls
      v-if="ttsIsActive"
      :status="ttsStatus"
      :progress="ttsProgress"
      :activeIndex="ttsActiveIndex"
      :wordCount="ttsWordCount"
      :provider="ttsCurrentProvider"
      :settings="effectiveEpubSettings"
      @start="startTtsPlayback"
      @prefetch="void tts.prefetchPlaybackAhead()"
      @pause="tts.pause"
      @resume="tts.resume"
      @replay="tts.replay"
      @skipBack="tts.skipBackward"
      @skipForward="tts.skipForward"
      @toggleSettings="showTtsSettings = true"
      @updateProvider="(provider) => applyTtsUpdate({ ttsProvider: provider })"
      @updateRate="(rate) => applyTtsUpdate({ ttsRate: rate })"
    />

    <TtsSettingsPanel v-if="showTtsSettings" :settings="effectiveEpubSettings" @update="applyTtsUpdate" @close="showTtsSettings = false" />

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
      @continueSaved="resumeTtsAtSavedPosition"
      @startHere="startTtsFromCurrentSection"
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
