import { onUnmounted, ref } from 'vue'
import { api, getAccessToken } from '@/lib/api'
import { useFoliateAnnotations } from './useFoliateAnnotations'
import { useFoliateSelection } from './useFoliateSelection'
import { useFoliateInput } from './useFoliateInput'
import type { EpubBookInfo } from '@bookorbit/types'

export interface RelocateDetail {
  cfi?: string | null
  fraction?: number
  index?: number
  total?: number
  tocItem?: { label?: string; href?: string }
  section?: { current: number; total: number }
  location?: { current: number; next: number; total: number }
  time?: { section: number; total: number }
}

export interface FoliateRenderer {
  heads?: HTMLElement[]
  feet?: HTMLElement[]
  setStyles?: (css: string) => void
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
  getContents?: () => { index?: number; doc?: Document }[]
}

export function useFoliate(
  container: () => HTMLElement | null,
  onRelocate?: (detail: RelocateDetail) => void,
  onApplyStyles?: (renderer: FoliateRenderer) => void,
  onMiddleTap?: () => void,
  onDocumentLoad?: (doc: Document) => void,
) {
  const loading = ref(false)
  const restoring = ref(false)
  const error = ref<string | null>(null)
  let initialRestoreDone: Promise<void> | undefined
  const fraction = ref(0)
  const viewRef = ref<unknown>(null)
  const bookLanguage = ref<string>('en')

  const annotations = useFoliateAnnotations()
  const selection = useFoliateSelection(() => viewRef.value)
  const input = useFoliateInput(() => viewRef.value, onMiddleTap, selection.handleSelectionEnd, selection.handleSelectionChange)

  async function loadScript() {
    if (customElements.get('foliate-view')) return
    const src = import.meta.env.DEV ? `/assets/foliate/view.js?v=${Date.now()}` : '/assets/foliate/view.js'
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.type = 'module'
      script.src = src
      script.onload = () => setTimeout(resolve, 100)
      script.onerror = () => reject(new Error('Failed to load foliate/view.js'))
      document.head.appendChild(script)
    })
    await customElements.whenDefined('foliate-view')
  }

  async function open(
    bookId: number,
    fileId: number,
    format: string,
    cfi?: string | null,
    fallbackFraction?: number,
    options?: { hasCachedProgress?: boolean; initialSectionIndex?: number },
  ) {
    let loadTimeoutId: ReturnType<typeof setTimeout> | undefined
    let resolveInitialRestore: (() => void) | undefined
    initialRestoreDone = new Promise<void>((resolve) => {
      resolveInitialRestore = resolve
    })

    const el = container()
    if (!el) {
      resolveInitialRestore?.()
      resolveInitialRestore = undefined
      return
    }

    const hasCachedProgress = options?.hasCachedProgress ?? false
    restoring.value = hasCachedProgress
    loading.value = !hasCachedProgress
    error.value = null
    let restoreAfterInitialLoad = false
    const pendingRestore = {
      cfi: cfi ?? null,
      fraction: fallbackFraction,
      sectionIndex: options?.initialSectionIndex,
    }
    restoreAfterInitialLoad = !!(
      pendingRestore.sectionIndex !== undefined ||
      pendingRestore.cfi ||
      (pendingRestore.fraction !== undefined && pendingRestore.fraction > 0)
    )

    async function navigateToRestore(view: { goTo: (target: string | number) => Promise<void>; goToFraction?: (f: number) => void }) {
      if (pendingRestore.sectionIndex !== undefined) {
        await view.goTo(pendingRestore.sectionIndex)
        return
      }
      if (pendingRestore.cfi) {
        try {
          await view.goTo(pendingRestore.cfi)
          return
        } catch {
          // fall through to fraction/start
        }
      }
      if (pendingRestore.fraction !== undefined && pendingRestore.fraction > 0) {
        view.goToFraction?.(pendingRestore.fraction)
        return
      }
      await view.goTo(0).catch(() => {})
    }

    try {
      await loadScript()

      const view = document.createElement('foliate-view') as HTMLElement & {
        renderer: FoliateRenderer
        open: (file: File) => Promise<void>
        goTo: (target: string | number) => Promise<void>
        goToFraction?: (f: number) => void
        book?: { toc?: unknown[] }
        getSectionFractions?: () => number[]
        prev?: () => void
        next?: () => void
        destroy?: () => void
        getCFI?: (index: number, range: Range) => string | null
        addAnnotation?: (ann: { value: string }) => void
        deleteAnnotation?: (ann: { value: string }) => void
        search?: (opts: { query: string }) => AsyncIterable<unknown>
        clearSearch?: () => void
      }
      view.style.cssText = 'width:100%;height:100%;display:block;'
      el.innerHTML = ''
      el.appendChild(view)
      viewRef.value = view
      input.attachViewTouches(view)

      // Safety timeout: if the 'load' event never fires (e.g. service worker or
      // iframe restrictions on iOS), clear the loading state with a helpful message
      // so the UI doesn't get stuck forever.

      view.addEventListener('load', (e: Event) => {
        const detail = (e as CustomEvent).detail
        clearTimeout(loadTimeoutId)
        loading.value = false
        restoring.value = false
        // The paginator's internal #view reference is updated in a microtask after the
        // 'load' event fires. Deferring to a macrotask ensures setStyles targets the
        // new chapter document, not the previous one.
        setTimeout(() => {
          if (onApplyStyles) onApplyStyles(view.renderer)
          const finishInitialRestore = () => {
            resolveInitialRestore?.()
            resolveInitialRestore = undefined
          }
          if (restoreAfterInitialLoad) {
            restoreAfterInitialLoad = false
            void navigateToRestore(view)
              .then(() => {
                const doc = view.renderer?.getContents?.()?.[0]?.doc
                if (doc) {
                  onDocumentLoad?.(doc)
                  input.attachIframeClicks(doc)
                }
              })
              .finally(finishInitialRestore)
          } else {
            finishInitialRestore()
          }
        }, 0)
        annotations.reAddAll(view)
        if (detail?.doc) {
          onDocumentLoad?.(detail.doc)
          input.attachIframeClicks(detail.doc)
        }
      })

      view.addEventListener('draw-annotation', (e: Event) => {
        annotations.handleDrawAnnotationEvent(e as CustomEvent)
      })

      view.addEventListener('relocate', (e: Event) => {
        const detail = (e as CustomEvent).detail
        fraction.value = detail?.fraction ?? 0
        onRelocate?.(detail)
      })

      view.addEventListener('error', (e: Event) => {
        const detail = (e as CustomEvent).detail
        console.error('[foliate] error event', detail)
        clearTimeout(loadTimeoutId)
        error.value = detail?.message ?? 'Reader error'
        loading.value = false
        restoring.value = false
        resolveInitialRestore?.()
        resolveInitialRestore = undefined
      })

      loadTimeoutId = setTimeout(() => {
        if (loading.value) {
          error.value = 'Could not open the book. Your browser may not fully support the reader. Try refreshing or using a different browser.'
          loading.value = false
          restoring.value = false
          resolveInitialRestore?.()
          resolveInitialRestore = undefined
        }
      }, 30_000)

      if (format === 'epub') {
        const infoRes = await api(`/api/v1/epub/${bookId}/info?fileId=${fileId}`)
        if (!infoRes.ok) throw new Error(`Failed to fetch EPUB info: ${infoRes.status}`)
        const bookInfo = await infoRes.json()
        const rawLang = (bookInfo as EpubBookInfo)?.metadata?.language
        bookLanguage.value = typeof rawLang === 'string' && rawLang ? (rawLang.split('-')[0] ?? 'en').toLowerCase() : 'en'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const makeStreamingBook = (window as any).makeStreamingBook as
          | ((id: number, base: string, info: unknown, token: string | null, bookType: null, fileId: number) => Promise<unknown>)
          | undefined
        if (!makeStreamingBook) throw new Error('makeStreamingBook not available')
        const book = await makeStreamingBook(bookId, '/api/v1/epub', bookInfo, getAccessToken(), null, fileId)
        await view.open(book as never)
      } else {
        const mimeType = format === 'pdf' ? 'application/pdf' : 'application/zip'
        const ext = format === 'pdf' ? 'pdf' : format === 'cbz' ? 'cbz' : format
        const res = await api(`/api/v1/books/files/${fileId}/serve`)
        if (!res.ok) throw new Error(`Failed to fetch book file: ${res.status}`)
        const blob = await res.blob()
        const file = new File([blob], `book-file-${fileId}.${ext}`, { type: mimeType })
        await view.open(file)
      }
      if (onApplyStyles) onApplyStyles(view.renderer)
      await view.goTo(0).catch(() => {})
    } catch (e) {
      console.error('[useFoliate]', e)
      clearTimeout(loadTimeoutId)
      error.value = e instanceof Error ? e.message : 'Failed to open book'
      loading.value = false
      restoring.value = false
      resolveInitialRestore?.()
      resolveInitialRestore = undefined
    }
  }

  async function waitForInitialRestore() {
    await initialRestoreDone
  }

  function getViewEl() {
    return viewRef.value as
      | (ReturnType<typeof document.createElement> & {
          prev?: () => void
          next?: () => void
          goTo?: (t: string | number) => Promise<void>
          goToFraction?: (f: number) => void
          getSectionFractions?: () => number[]
          book?: { toc?: unknown[] }
          renderer?: FoliateRenderer
          destroy?: () => void
        })
      | null
  }

  onUnmounted(() => {
    input.cleanup()
    getViewEl()?.destroy?.()
    viewRef.value = null
  })

  return {
    loading,
    restoring,
    error,
    fraction,
    bookLanguage,
    view: viewRef,
    open: (
      bookId: number,
      fileId: number,
      format: string,
      cfi?: string | null,
      fallbackFraction?: number,
      options?: { hasCachedProgress?: boolean; initialSectionIndex?: number },
    ) => open(bookId, fileId, format, cfi, fallbackFraction, options),
    prev: () => getViewEl()?.prev?.(),
    next: () => getViewEl()?.next?.(),
    goTo: (t: string | number) => getViewEl()?.goTo?.(t),
    goToFraction: (f: number) => getViewEl()?.goToFraction?.(f),
    goToSection: (i: number) => getViewEl()?.goTo?.(i),
    getSectionFractions: (): number[] => getViewEl()?.getSectionFractions?.() ?? [],
    getChapters: (): unknown[] => getViewEl()?.book?.toc ?? [],
    getRenderer: (): FoliateRenderer | null => getViewEl()?.renderer ?? null,
    getActiveDocument: (): Document | null => getViewEl()?.renderer?.getContents?.()?.[0]?.doc ?? null,
    waitForInitialRestore,
    addAnnotation: (cfi: string, color = '#FACC15', style = 'highlight') => annotations.addAnnotation(viewRef.value, cfi, color, style),
    addAnnotations: (anns: { cfi: string; color: string; style: string }[]) => annotations.addAnnotations(viewRef.value, anns),
    deleteAnnotation: (cfi: string) => annotations.deleteAnnotation(viewRef.value, cfi),
    setTextSelectedHandler: selection.setHandler,
  }
}
