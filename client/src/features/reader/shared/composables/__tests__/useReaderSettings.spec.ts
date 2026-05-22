import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { EPUB_READER_DEFAULTS, type EpubReaderSettings } from '@bookorbit/types'
import { isReaderSyncEnabled, useReaderSettings } from '../useReaderSettings'

const apiMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>())

vi.mock('@/lib/api', () => ({ api: apiMock }))

const userRef = vi.hoisted(() =>
  ref({
    settings: { syncReaderPreferences: true },
  }),
)

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({ user: userRef }),
}))

describe('isReaderSyncEnabled', () => {
  it('defaults to enabled when syncReaderPreferences is unset', () => {
    expect(isReaderSyncEnabled({ settings: {} })).toBe(true)
    expect(isReaderSyncEnabled({ settings: { syncReaderPreferences: undefined } })).toBe(true)
  })

  it('respects explicit opt-out', () => {
    expect(isReaderSyncEnabled({ settings: { syncReaderPreferences: false } })).toBe(false)
  })

  it('is disabled when user is missing', () => {
    expect(isReaderSyncEnabled(null)).toBe(false)
  })
})

describe('useReaderSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    userRef.value = { settings: { syncReaderPreferences: true } }
    apiMock.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('updates local settings immediately while debouncing per-book preference sync', async () => {
    vi.useFakeTimers()
    const { updateBookSettings, effective } = useReaderSettings(4, 'epub')

    updateBookSettings({ footerDisplayMode: 2 } as Partial<EpubReaderSettings>)

    expect((effective.value as EpubReaderSettings).footerDisplayMode).toBe(2)
    expect(apiMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)

    const putCalls = apiMock.mock.calls.filter(
      (call) => call[0] === '/api/v1/reader/preferences/4' && (call[1] as { method?: string } | undefined)?.method === 'PUT',
    )
    expect(putCalls).toHaveLength(1)
    expect(JSON.parse((putCalls[0]![1] as { body: string }).body)).toEqual({
      settings: {
        footerDisplayMode: 2,
      },
    })
  })

  it('syncs global in-reader settings to account defaults', async () => {
    vi.useFakeTimers()
    const { updateGlobalSettings, effective } = useReaderSettings(4, 'epub')

    updateGlobalSettings({ fontSize: 20, ttsRate: 1.5, ttsProvider: 'azure' } as Partial<EpubReaderSettings>)

    const epubEffective = effective.value as EpubReaderSettings
    expect(epubEffective.fontSize).toBe(20)
    expect(epubEffective.ttsRate).toBe(1.5)
    expect(epubEffective.ttsProvider).toBe('azure')
    expect(localStorage.getItem('reader:default:epub')).toContain('"fontSize":20')
    expect(localStorage.getItem('reader:book:4')).toBeNull()
    expect(apiMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)

    const defaultPutCalls = apiMock.mock.calls.filter(
      (call) => call[0] === '/api/v1/reader/defaults/epub' && (call[1] as { method?: string } | undefined)?.method === 'PUT',
    )
    expect(defaultPutCalls).toHaveLength(1)
    expect(JSON.parse((defaultPutCalls[0]![1] as { body: string }).body)).toEqual({
      settings: {
        ...EPUB_READER_DEFAULTS,
        fontSize: 20,
        ttsRate: 1.5,
        ttsProvider: 'azure',
      },
    })
  })

  it('does not sync when reader preference sync is disabled', async () => {
    vi.useFakeTimers()
    userRef.value = { settings: { syncReaderPreferences: false } }
    const { updateGlobalSettings } = useReaderSettings(4, 'epub')

    updateGlobalSettings({ fontSize: 20 } as Partial<EpubReaderSettings>)
    await vi.advanceTimersByTimeAsync(500)

    expect(apiMock).not.toHaveBeenCalled()
  })

  it('stores highlight color changes under the active theme', async () => {
    const { updateGlobalSettings, effective } = useReaderSettings(4, 'epub')

    updateGlobalSettings({
      themeName: 'sepia',
      ttsSentenceHighlightColor: '#aa0000',
      ttsWordHighlightColor: '#bb0000',
      themeHighlightColors: {
        sepia: {
          ttsSentenceHighlightColor: '#aa0000',
          ttsWordHighlightColor: '#bb0000',
        },
      },
    } as Partial<EpubReaderSettings>)

    const epubEffective = effective.value as EpubReaderSettings
    expect(epubEffective.themeHighlightColors?.sepia).toEqual({
      ttsSentenceHighlightColor: '#aa0000',
      ttsWordHighlightColor: '#bb0000',
    })
    expect(epubEffective.ttsSentenceHighlightColor).toBe('#aa0000')
    expect(epubEffective.ttsWordHighlightColor).toBe('#bb0000')
  })

  it('resolves highlight colors from the active theme overrides', async () => {
    localStorage.setItem(
      'reader:default:epub',
      JSON.stringify({
        ...EPUB_READER_DEFAULTS,
        themeName: 'sepia',
        themeHighlightColors: {
          sepia: {
            ttsSentenceHighlightColor: '#aa0000',
            ttsWordHighlightColor: '#bb0000',
          },
        },
      }),
    )

    const { load, effective } = useReaderSettings(4, 'epub')
    await load()

    const epubEffective = effective.value as EpubReaderSettings
    expect(epubEffective.ttsSentenceHighlightColor).toBe('#aa0000')
    expect(epubEffective.ttsWordHighlightColor).toBe('#bb0000')
  })
})
