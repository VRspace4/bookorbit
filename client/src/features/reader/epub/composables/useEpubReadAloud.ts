import { computed, nextTick, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { toast } from 'vue-sonner'
import type { EpubReaderSettings } from '@bookorbit/types'
import { useEpubTts } from './useEpubTts'
import type { FoliateRenderer } from './useFoliate'
import type { useReaderProgress } from '../../shared/composables/useReaderProgress'
import { buildThemeHighlightPatch } from '../theme-highlight'
import { readTtsPlaybackSession, writeTtsPlaybackSession } from '../tts/tts-session-cache'
import { isAwayFromLastTtsPosition } from '../lib/tts-resume'

type TtsPosition = { sectionIndex: number; wordIndex: number }

export interface EpubReadAloudOptions {
  fileId: number
  /** False for formats with their own reader (PDF, comics, audio): skips the route-leave save. */
  enabled: boolean
  progress: Pick<ReturnType<typeof useReaderProgress>, 'getTtsPosition' | 'updateTtsPosition' | 'flush' | 'refreshFromServer'>
  sectionIndex: Ref<number>
  totalSections: Ref<number>
  chapterTitle: Ref<string>
  bookLanguage: Ref<string>
  settings: ComputedRef<EpubReaderSettings>
  updateGlobalSettings: (patch: Partial<EpubReaderSettings>) => void
  getActiveDocument: () => Document | null
  getRenderer: () => FoliateRenderer | null
  goTo: (target: string | number) => unknown
  goToSection: (index: number) => unknown
  waitForInitialRestore: () => Promise<void>
  dismissSelection: () => void
  readerShellRef: Ref<HTMLElement | null>
  ttsToolbarRef: Ref<{ $el?: unknown } | null>
}

/**
 * The fork's EPUB read-aloud (cloud voices, word highlight, follow-along) wired into the reader.
 * Kept out of ReaderView so upstream changes to the view merge without touching it.
 */
export function useEpubReadAloud(options: EpubReadAloudOptions) {
  const {
    fileId,
    progress,
    sectionIndex,
    totalSections,
    chapterTitle,
    bookLanguage,
    getActiveDocument,
    getRenderer,
    goTo,
    goToSection,
    readerShellRef,
    ttsToolbarRef,
  } = options
  const effectiveEpubSettings = options.settings
  const selection = { dismiss: options.dismissSelection }
  const bookSettings = { updateGlobalSettings: options.updateGlobalSettings }

  let ttsToolbarResizeObserver: ResizeObserver | null = null
  const showTtsSettings = ref(false)
  const ttsColorPickerTarget = ref<'sentence' | 'word' | null>(null)
  const showTtsResumeDialog = ref(false)
  const pendingTtsResume = ref<TtsPosition | null>(null)
  const ttsAutoAdvancing = ref(false)

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
      // Use live getters for size/start/scrolled - pinWordRangeAsViewportLead reads
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
          return typeof scrollProp === 'string' ? (scrolled ? scrollProp === 'scrollLeft' : scrollProp === 'scrollTop') : false
        },
        scrollBy: renderer.scrollBy?.bind(renderer),
        scrollToAnchor: renderer.scrollToAnchor?.bind(renderer),
      }
    },
  })

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
   * `.reader-content-area` uses a 300ms bottom transition - must wait past that or the
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
      const savedWordVisibleInViewport = saved.sectionIndex === sectionIndex.value ? tts.isWordVisibleInViewport(saved.wordIndex) : false
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

    // No prior TTS position - enable and wait for tap.
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
      // Not on last-read page - remind and wait for a page tap.
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
    // Layout may still be settling after a section change - re-jump once more.
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

  async function snapToSectionFraction(sectionFraction: number | null) {
    if (sectionFraction == null || !Number.isFinite(sectionFraction)) return
    const renderer = getRenderer()
    if (renderer && renderer.scrolled !== true && typeof renderer.scrollToAnchor === 'function') {
      await renderer.scrollToAnchor(sectionFraction).catch(() => {})
    }
  }

  let restoreTtsPosition: TtsPosition | null = null
  let pendingTtsSession: ReturnType<typeof readTtsPlaybackSession> = null
  let restoresToolbar = false

  /** Call after progress and settings load, before the book opens. True when the toolbar comes back. */
  async function prepareRestore(): Promise<boolean> {
    restoreTtsPosition = progress.getTtsPosition()
    pendingTtsSession = readTtsPlaybackSession(fileId)
    restoresToolbar = Boolean(pendingTtsSession?.enabled)
    if (restoresToolbar) alignTtsSessionWithProgress(restoreTtsPosition ?? undefined)
    void tts.warmUp()
    // Restore TTS chrome first so pagination/scroll geometry matches last session.
    if (restoresToolbar) await settleTtsChromeLayout()
    return restoresToolbar
  }

  /** Call once the book has opened at the saved position. */
  async function finishRestore(restoreCfi: string | null, restoreSectionFraction: number | null) {
    if (!restoresToolbar) return
    await options.waitForInitialRestore()
    // Re-apply the position after the toolbar reflow so we do not stay on a chapter-start page.
    if (restoreCfi) await Promise.resolve(goTo(restoreCfi)).catch(() => {})
    await snapToSectionFraction(restoreSectionFraction)

    // Highlight/resume on the restored page without jumping away unless auto-resume needs the
    // saved TTS section (playing across sections).
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

    // TTS highlight restore / residual auto-resume must not leave us on the wrong page or the next
    // spine section. Re-snap to the pre-TTS reading position when still on the opening section.
    if (sectionIndex.value === sectionBeforeTts) {
      if (restoreCfi) await Promise.resolve(goTo(restoreCfi)).catch(() => {})
      await snapToSectionFraction(restoreSectionFraction)
      if (tts.isActive.value) tts.restoreTtsHighlightNow()
    }
  }

  async function refreshHighlightIfActive() {
    if (!tts.isActive.value) return
    await nextTick()
    tts.refreshTtsHighlight()
  }

  function onRelocate() {
    if (tts.isActive.value) tts.evaluateScrollFollow()
  }

  /** Closes the topmost read-aloud panel; false when none was open. */
  function closePanel(): boolean {
    if (showTtsSettings.value) {
      showTtsSettings.value = false
      return true
    }
    if (ttsColorPickerTarget.value) {
      ttsColorPickerTarget.value = null
      return true
    }
    return false
  }

  function markLeaving() {
    if (options.enabled) isLeavingReader.value = true
  }

  function prefetchTts() {
    void tts.prefetchPlaybackAhead()
  }

  function handleTtsProviderUpdate(provider: EpubReaderSettings['ttsProvider']) {
    applyTtsUpdate({ ttsProvider: provider })
  }

  function handleTtsRateUpdate(rate: number) {
    applyTtsUpdate({ ttsRate: rate })
  }

  onBeforeRouteLeave(async () => {
    if (!options.enabled) return true
    isLeavingReader.value = true
    const savedTts = ttsFollowTarget.value ?? progress.getTtsPosition()
    tts.persistForNavigation({
      sectionIndex: savedTts?.sectionIndex ?? sectionIndex.value,
      wordIndex: savedTts?.wordIndex,
    })
    await progress.flush()
    return true
  })

  onUnmounted(() => {
    ttsToolbarResizeObserver?.disconnect()
    ttsToolbarResizeObserver = null
  })

  return {
    tts,
    handleDocumentLoad: tts.handleDocumentLoad,
    ttsStatus,
    ttsProgress,
    ttsActiveIndex,
    ttsWordCount,
    ttsCurrentProvider,
    ttsIsActive,
    showTtsFollowAlong,
    showTtsSettings,
    ttsColorPickerTarget,
    showTtsResumeDialog,
    pendingTtsResume,
    ttsResumeSavedLabel,
    ttsResumeCurrentLabel,
    ttsResumeSameView,
    prepareRestore,
    finishRestore,
    refreshHighlightIfActive,
    onRelocate,
    closePanel,
    markLeaving,
    toggleTts,
    startTtsPlayback,
    resumeTtsPlayback,
    followTtsPosition,
    prefetchTts,
    handleTtsProviderUpdate,
    handleTtsRateUpdate,
    applyTtsUpdate,
    openTtsColorPicker,
    closeTtsColorPicker,
    resumeTtsAtSavedPosition,
    startTtsFromHereAwaitingTap,
    cancelTtsResumeDialog,
  }
}
