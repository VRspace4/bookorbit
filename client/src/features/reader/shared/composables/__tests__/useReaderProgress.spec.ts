import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { formatTimeRemaining, useReaderProgress } from '../useReaderProgress'
import type { RelocateDetail } from '../../../epub/composables/useFoliate'

const apiMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))

/** `GET /reading-progress?fileId=` as the server answers it: one grouped entry. */
function serverProgress(p: {
  cfi: string | null
  pageNumber: number | null
  percentage: number
  ttsSectionIndex: number | null
  ttsWordIndex: number | null
  updatedAt: string
}) {
  return {
    ok: true,
    json: async () => ({
      items: [
        {
          fileId: 1,
          percentage: p.percentage,
          updatedAt: p.updatedAt,
          text: { cfi: p.cfi, page: p.pageNumber, updatedAt: p.updatedAt },
          narration: { seconds: null, fragment: null, sectionIndex: null, percentage: null, updatedAt: null },
          kobo: { source: null, type: null, value: null, contentPercent: null },
          koreader: null,
          tts: { sectionIndex: p.ttsSectionIndex, wordIndex: p.ttsWordIndex },
        },
      ],
    }),
  }
}

function progressPuts() {
  return apiMock.mock.calls.filter((c: unknown[]) => c[0] === '/api/v1/reading-progress' && (c[1] as { method?: string })?.method === 'PUT')
}

function writeOf(call: unknown[]) {
  return JSON.parse((call[1] as { body: string }).body).writes[0]
}

describe('formatTimeRemaining', () => {
  it('returns empty string for NaN', () => {
    expect(formatTimeRemaining(NaN)).toBe('')
  })

  it('returns empty string for negative values', () => {
    expect(formatTimeRemaining(-5)).toBe('')
  })

  it('returns empty string for Infinity', () => {
    expect(formatTimeRemaining(Infinity)).toBe('')
  })

  it('returns "< 1 min" for values less than 1', () => {
    expect(formatTimeRemaining(0)).toBe('< 1 min')
    expect(formatTimeRemaining(0.5)).toBe('< 1 min')
    expect(formatTimeRemaining(0.99)).toBe('< 1 min')
  })

  it('returns minutes for values less than 60', () => {
    expect(formatTimeRemaining(1)).toBe('1 min')
    expect(formatTimeRemaining(15)).toBe('15 min')
    expect(formatTimeRemaining(59.4)).toBe('59 min')
  })

  it('returns hours only when remainder is 0', () => {
    expect(formatTimeRemaining(60)).toBe('1 hr')
    expect(formatTimeRemaining(120)).toBe('2 hr')
  })

  it('returns hours and minutes for larger values', () => {
    expect(formatTimeRemaining(90)).toBe('1 hr 30 min')
    expect(formatTimeRemaining(150)).toBe('2 hr 30 min')
  })
})

describe('useReaderProgress', () => {
  const elapsedMinutes = ref(0)

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    apiMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    elapsedMinutes.value = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeDetail(overrides?: Partial<RelocateDetail>): RelocateDetail {
    return {
      cfi: 'epubcfi(/6/4)',
      fraction: 0.35,
      index: 2,
      source: 'OEBPS/html/ch3.xhtml',
      koboLocationType: 'KoboSpan',
      koboLocationValue: 'kobo.25.1',
      contentSourceProgressPercent: 25,
      koreaderProgress: '/body/DocFragment[3]/body/p[4]/text()[1].2',
      total: 10,
      tocItem: { label: 'Chapter 3', href: 'ch3.xhtml' },
      section: { current: 2, total: 10 },
      location: { current: 35, next: 36, total: 100 },
      time: { section: 12.5, total: 45.3 },
      ...overrides,
    }
  }

  it('populates all refs from a full relocate detail', () => {
    const progress = useReaderProgress(1, 1, elapsedMinutes)
    progress.onRelocate(makeDetail())

    expect(progress.cfi.value).toBe('epubcfi(/6/4)')
    expect(progress.fraction.value).toBe(0.35)
    expect(progress.percentage.value).toBe(35)
    expect(progress.koboLocationSource.value).toBe('OEBPS/html/ch3.xhtml')
    expect(progress.koboLocationType.value).toBe('KoboSpan')
    expect(progress.koboLocationValue.value).toBe('kobo.25.1')
    expect(progress.koboContentSourceProgressPercent.value).toBe(25)
    expect(progress.koreaderProgress.value).toBe('/body/DocFragment[3]/body/p[4]/text()[1].2')
    expect(progress.chapterTitle.value).toBe('Chapter 3')
    expect(progress.sectionIndex.value).toBe(2)
    expect(progress.totalSections.value).toBe(10)
    expect(progress.locationCurrent.value).toBe(35)
    expect(progress.locationTotal.value).toBe(100)
    expect(progress.sectionCurrent.value).toBe(2)
    expect(progress.sectionTotal.value).toBe(10)
    expect(progress.timeSection.value).toBe(12.5)
    expect(progress.timeTotal.value).toBe(45.3)
  })

  it('handles missing location/section/time gracefully', () => {
    const progress = useReaderProgress(1, 1, elapsedMinutes)
    progress.onRelocate({
      cfi: 'epubcfi(/6/2)',
      fraction: 0.1,
      index: 1,
      total: 5,
    })

    expect(progress.locationCurrent.value).toBe(0)
    expect(progress.locationTotal.value).toBe(0)
    expect(progress.sectionCurrent.value).toBe(0)
    expect(progress.sectionTotal.value).toBe(0)
    expect(progress.timeSection.value).toBe(0)
    expect(progress.timeTotal.value).toBe(0)
  })

  it('falls back to index/total when section is missing', () => {
    const progress = useReaderProgress(1, 1, elapsedMinutes)
    progress.onRelocate({
      cfi: 'epubcfi(/6/2)',
      fraction: 0.1,
      index: 3,
      total: 8,
    })

    expect(progress.sectionIndex.value).toBe(3)
    expect(progress.totalSections.value).toBe(8)
  })

  it('cycles footer mode 0 -> 1 -> 2 -> 0', () => {
    const progress = useReaderProgress(1, 1, elapsedMinutes, 0)

    expect(progress.footerMode.value).toBe(0)
    progress.cycleFooterMode()
    expect(progress.footerMode.value).toBe(1)
    progress.cycleFooterMode()
    expect(progress.footerMode.value).toBe(2)
    progress.cycleFooterMode()
    expect(progress.footerMode.value).toBe(0)
  })

  it('initializes footer mode from parameter', () => {
    const progress = useReaderProgress(1, 1, elapsedMinutes, 2)
    expect(progress.footerMode.value).toBe(2)
  })

  it('handles null/undefined detail gracefully', () => {
    const progress = useReaderProgress(1, 1, elapsedMinutes)
    progress.onRelocate(undefined as unknown as RelocateDetail)

    expect(progress.cfi.value).toBeNull()
    expect(progress.fraction.value).toBe(0)
    expect(progress.percentage.value).toBe(0)
  })

  describe('buildFooterContent (tested via internal state)', () => {
    it('mode 0: shows page info and percentage', () => {
      const progress = useReaderProgress(1, 1, elapsedMinutes, 0)
      progress.onRelocate(makeDetail({ fraction: 0.35, location: { current: 35, next: 36, total: 100 } }))

      // We can't directly test buildFooterContent since it's private,
      // but we verify the underlying state that feeds it
      expect(progress.locationCurrent.value).toBe(35)
      expect(progress.locationTotal.value).toBe(100)
      expect(progress.footerMode.value).toBe(0)
    })

    it('mode 1: uses elapsed minutes from session', () => {
      elapsedMinutes.value = 15
      const progress = useReaderProgress(1, 1, elapsedMinutes, 1)
      progress.onRelocate(makeDetail({ time: { section: 10, total: 42 } }))

      expect(progress.timeTotal.value).toBe(42)
      expect(progress.footerMode.value).toBe(1)
    })

    it('mode 2: uses section/chapter time', () => {
      const progress = useReaderProgress(1, 1, elapsedMinutes, 2)
      progress.onRelocate(makeDetail({ section: { current: 3, total: 12 }, time: { section: 8, total: 45 } }))

      expect(progress.sectionCurrent.value).toBe(3)
      expect(progress.sectionTotal.value).toBe(12)
      expect(progress.timeSection.value).toBe(8)
    })
  })

  it('debounces save calls on relocate', async () => {
    vi.useFakeTimers()
    const progress = useReaderProgress(1, 1, elapsedMinutes)

    progress.onRelocate(makeDetail({ fraction: 0.1 }))
    progress.onRelocate(makeDetail({ fraction: 0.2 }))
    progress.onRelocate(makeDetail({ fraction: 0.3 }))

    expect(apiMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2500)

    const saveCalls = apiMock.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0] === '/api/v1/reading-progress' && (c[1] as { method?: string })?.method === 'PUT',
    )
    expect(saveCalls.length).toBe(1)
    const saveCall = saveCalls[0]
    if (!saveCall) throw new Error('Expected one progress save call')
    const saveBody = JSON.parse((saveCall[1] as { body: string }).body).writes[0]
    expect(saveBody).toEqual(
      expect.objectContaining({
        percentage: 30,
        kobo: { source: 'OEBPS/html/ch3.xhtml', type: 'KoboSpan', value: 'kobo.25.1', contentPercent: 25 },
        koreader: '/body/DocFragment[3]/body/p[4]/text()[1].2',
      }),
    )

    vi.useRealTimers()
  })

  it('omits non-string kobo location source from saved progress', async () => {
    vi.useFakeTimers()
    try {
      const progress = useReaderProgress(1, 1, elapsedMinutes)

      progress.onRelocate(
        makeDetail({
          cfi: 'epubcfi(/6/38!/4,/488/2/1:604,/512/2/1:89)',
          fraction: 0.69604585363819,
          source: 18,
          koboLocationType: null,
          koboLocationValue: null,
          contentSourceProgressPercent: 87.5,
          koreaderProgress: '/body/DocFragment[19]/body/p[222]/font/text().604',
        } as never),
      )

      vi.clearAllTimers()
      await progress.save()

      const saveCall = apiMock.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0] === '/api/v1/reading-progress' && (c[1] as { method?: string })?.method === 'PUT',
      )
      if (!saveCall) throw new Error('Expected progress save call')
      const saveBody = JSON.parse((saveCall[1] as { body: string }).body).writes[0]

      expect(saveBody).toEqual(
        expect.objectContaining({
          text: { cfi: 'epubcfi(/6/38!/4,/488/2/1:604,/512/2/1:89)', page: null },
          percentage: 69.604585363819,
          kobo: { source: null, type: null, value: null, contentPercent: 87.5 },
          koreader: '/body/DocFragment[19]/body/p[222]/font/text().604',
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps relocate state in memory without loading or saving when tracking is disabled', async () => {
    vi.useFakeTimers()
    const trackingEnabled = ref(false)
    const progress = useReaderProgress(1, 1, elapsedMinutes, 0, { trackingEnabled })

    await progress.load()
    progress.onRelocate(makeDetail({ fraction: 0.42 }))
    await progress.save()
    await vi.advanceTimersByTimeAsync(2500)

    expect(progress.percentage.value).toBe(42)
    expect(apiMock).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('flushes pending save immediately on flush()', async () => {
    vi.useFakeTimers()
    const progress = useReaderProgress(1, 1, elapsedMinutes)

    progress.onRelocate(makeDetail({ fraction: 0.42, cfi: 'epubcfi(/6/8)' }))

    expect(apiMock).not.toHaveBeenCalled()

    await progress.flush()

    const saveCalls = progressPuts()
    expect(saveCalls.length).toBe(1)
    const body = writeOf(saveCalls[0]!)
    expect(body).toMatchObject({ text: { cfi: 'epubcfi(/6/8)' }, percentage: 42 })
    // A page turn must not clear a narration or read-aloud position another device saved.
    expect(body).not.toHaveProperty('narration')
    expect(body).not.toHaveProperty('tts')

    vi.useRealTimers()
  })

  it('prefers a newer local cache over older server progress on load', async () => {
    localStorage.setItem(
      'reader:progress:12',
      JSON.stringify({
        cfi: 'epubcfi(/6/10)',
        pageNumber: 4,
        positionSeconds: null,
        percentage: 44,
        ttsSectionIndex: 1,
        ttsWordIndex: 2,
        updatedAt: new Date('2026-05-22T12:00:00.000Z').toISOString(),
      }),
    )
    apiMock.mockResolvedValue(
      serverProgress({
        cfi: 'epubcfi(/6/2)',
        pageNumber: 1,
        percentage: 10,
        ttsSectionIndex: 5,
        ttsWordIndex: 88,
        updatedAt: new Date('2026-05-21T11:00:00.000Z').toISOString(),
      }),
    )

    const progress = useReaderProgress(1, 12, elapsedMinutes)
    await progress.load()

    expect(progress.cfi.value).toBe('epubcfi(/6/10)')
    expect(progress.percentage.value).toBe(44)
    expect(progress.getTtsPosition()).toEqual({ sectionIndex: 1, wordIndex: 2 })
    // Fresher local progress is pushed back to the server.
    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/api/v1/reading-progress',
        expect.objectContaining({
          method: 'PUT',
        }),
      )
    })
  })

  it('prefers newer server progress over an older local cache on load', async () => {
    localStorage.setItem(
      'reader:progress:15',
      JSON.stringify({
        cfi: 'epubcfi(/6/10)',
        pageNumber: 4,
        positionSeconds: null,
        percentage: 44,
        ttsSectionIndex: 1,
        ttsWordIndex: 2,
        updatedAt: new Date('2026-05-20T12:00:00.000Z').toISOString(),
      }),
    )
    apiMock.mockResolvedValue(
      serverProgress({
        cfi: 'epubcfi(/6/2)',
        pageNumber: 1,
        percentage: 10,
        ttsSectionIndex: 5,
        ttsWordIndex: 88,
        updatedAt: new Date('2026-05-21T11:00:00.000Z').toISOString(),
      }),
    )

    const progress = useReaderProgress(1, 15, elapsedMinutes)
    await progress.load()

    expect(progress.cfi.value).toBe('epubcfi(/6/2)')
    expect(progress.percentage.value).toBe(10)
    expect(progress.getTtsPosition()).toEqual({ sectionIndex: 5, wordIndex: 88 })
  })

  it('falls back to cached progress when the server request fails', async () => {
    localStorage.setItem(
      'reader:progress:12',
      JSON.stringify({
        cfi: 'epubcfi(/6/10)',
        pageNumber: 4,
        positionSeconds: null,
        percentage: 44,
        updatedAt: new Date('2026-05-21T12:00:00.000Z').toISOString(),
      }),
    )
    apiMock.mockResolvedValue({ ok: false })

    const progress = useReaderProgress(1, 12, elapsedMinutes)
    await progress.load()

    expect(progress.cfi.value).toBe('epubcfi(/6/10)')
    expect(progress.percentage.value).toBe(44)
  })

  it('writes relocated progress to localStorage immediately', () => {
    vi.useFakeTimers()
    const progress = useReaderProgress(1, 13, elapsedMinutes)

    progress.onRelocate(makeDetail({ cfi: 'epubcfi(/6/12)', fraction: 0.62 }))

    const cached = JSON.parse(localStorage.getItem('reader:progress:13') ?? '{}')
    expect(cached).toMatchObject({
      cfi: 'epubcfi(/6/12)',
      percentage: 62,
      positionSeconds: null,
    })

    vi.useRealTimers()
  })

  it('updates relocate UI without caching a reflow that moves no reader', () => {
    const progress = useReaderProgress(1, 17, elapsedMinutes)

    progress.onRelocate(makeDetail({ cfi: 'epubcfi(/6/12)', fraction: 0.62, reason: 'anchor' }))

    expect(progress.cfi.value).toBe('epubcfi(/6/12)')
    expect(progress.percentage.value).toBe(62)
    expect(localStorage.getItem('reader:progress:17')).toBeNull()
  })

  it('persists TTS position in debounced progress saves', async () => {
    vi.useFakeTimers()
    const progress = useReaderProgress(1, 14, elapsedMinutes)

    progress.updateTtsPosition(3, 42)

    await vi.advanceTimersByTimeAsync(2500)

    const saveCalls = progressPuts()
    expect(saveCalls.length).toBe(1)
    expect(writeOf(saveCalls[0]!)).toMatchObject({ tts: { sectionIndex: 3, wordIndex: 42 } })

    const cached = JSON.parse(localStorage.getItem('reader:progress:14') ?? '{}')
    expect(cached).toMatchObject({ ttsSectionIndex: 3, ttsWordIndex: 42 })

    vi.useRealTimers()
  })

  it('refreshFromServer applies the latest server snapshot', async () => {
    const progress = useReaderProgress(1, 16, elapsedMinutes)
    progress.updateTtsPosition(1, 10)

    apiMock.mockResolvedValueOnce(
      serverProgress({
        cfi: 'epubcfi(/6/4)',
        pageNumber: null,
        percentage: 42,
        ttsSectionIndex: 7,
        ttsWordIndex: 21,
        updatedAt: new Date('2026-05-22T12:00:00.000Z').toISOString(),
      }),
    )

    await progress.refreshFromServer()

    expect(progress.getTtsPosition()).toEqual({ sectionIndex: 7, wordIndex: 21 })
    expect(progress.percentage.value).toBe(42)
  })

  it('loads persisted TTS position from the server', async () => {
    apiMock.mockResolvedValue(
      serverProgress({
        cfi: 'epubcfi(/6/2)',
        pageNumber: null,
        percentage: 10,
        ttsSectionIndex: 5,
        ttsWordIndex: 88,
        updatedAt: new Date('2026-05-21T12:00:00.000Z').toISOString(),
      }),
    )

    const progress = useReaderProgress(1, 15, elapsedMinutes)
    await progress.load()

    expect(progress.getTtsPosition()).toEqual({ sectionIndex: 5, wordIndex: 88 })
  })
})
