import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { EPUB_READER_DEFAULTS, migrateFlatEpubDefaultsToV2, type EpubReaderDefaultsStorageV2, type EpubReaderSettings } from '@bookorbit/types'
import { isReaderSyncEnabled, useReaderSettings } from '../useReaderSettings'

const apiMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>())

vi.mock('@/lib/api', () => ({ api: apiMock }))

const userRef = vi.hoisted(() =>
  ref({
    settings: { syncReaderPreferences: true },
  }),
)

const deviceFormFactorRef = vi.hoisted(() => ref<'mobile' | 'tablet' | 'desktop'>('desktop'))

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({ user: userRef }),
}))

vi.mock('@/features/reader/shared/lib/device-form-factor', () => ({
  useReaderDeviceFormFactor: () => ({ deviceFormFactor: deviceFormFactorRef }),
  getReaderDeviceFormFactor: () => deviceFormFactorRef.value,
}))

function readEpubDefaults(): EpubReaderDefaultsStorageV2 {
  const raw = localStorage.getItem('reader:default:epub')
  expect(raw).toBeTruthy()
  return JSON.parse(raw!) as EpubReaderDefaultsStorageV2
}

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
    deviceFormFactorRef.value = 'desktop'
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

    const stored = readEpubDefaults()
    expect(stored.v).toBe(2)
    expect(stored.devices.desktop.fontSize).toBe(20)
    expect(stored.shared.ttsRate).toBe(1.5)
    expect(stored.shared.ttsProvider).toBe('azure')
    expect(localStorage.getItem('reader:book:4')).toBeNull()
    expect(apiMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)

    const defaultPutCalls = apiMock.mock.calls.filter(
      (call) => call[0] === '/api/v1/reader/defaults/epub' && (call[1] as { method?: string } | undefined)?.method === 'PUT',
    )
    expect(defaultPutCalls).toHaveLength(1)
    expect(JSON.parse((defaultPutCalls[0]![1] as { body: string }).body)).toEqual({
      settings: stored,
    })
  })

  it('stores appearance, text, and layout settings per device form factor', () => {
    const { updateGlobalSettings, effective } = useReaderSettings(4, 'epub')

    deviceFormFactorRef.value = 'mobile'
    updateGlobalSettings({ fontSize: 18, maxColumnCount: 1 } as Partial<EpubReaderSettings>)
    expect((effective.value as EpubReaderSettings).fontSize).toBe(18)

    deviceFormFactorRef.value = 'desktop'
    updateGlobalSettings({ fontSize: 22, maxColumnCount: 2 } as Partial<EpubReaderSettings>)
    expect((effective.value as EpubReaderSettings).fontSize).toBe(22)

    const stored = readEpubDefaults()
    expect(stored.devices.mobile.fontSize).toBe(18)
    expect(stored.devices.mobile.maxColumnCount).toBe(1)
    expect(stored.devices.desktop.fontSize).toBe(22)
    expect(stored.devices.desktop.maxColumnCount).toBe(2)

    deviceFormFactorRef.value = 'mobile'
    expect((effective.value as EpubReaderSettings).fontSize).toBe(18)
    expect((effective.value as EpubReaderSettings).maxColumnCount).toBe(1)
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

    const stored = readEpubDefaults()
    expect(stored.devices.desktop.themeName).toBe('sepia')
    expect(stored.shared.themeHighlightColors?.sepia).toEqual({
      ttsSentenceHighlightColor: '#aa0000',
      ttsWordHighlightColor: '#bb0000',
    })
  })

  it('resolves highlight colors from the active theme overrides', async () => {
    localStorage.setItem(
      'reader:default:epub',
      JSON.stringify(
        migrateFlatEpubDefaultsToV2({
          ...EPUB_READER_DEFAULTS,
          themeName: 'sepia',
          themeHighlightColors: {
            sepia: {
              ttsSentenceHighlightColor: '#aa0000',
              ttsWordHighlightColor: '#bb0000',
            },
          },
        }),
      ),
    )

    const { load, effective } = useReaderSettings(4, 'epub')
    await load()

    const epubEffective = effective.value as EpubReaderSettings
    expect(epubEffective.ttsSentenceHighlightColor).toBe('#aa0000')
    expect(epubEffective.ttsWordHighlightColor).toBe('#bb0000')
  })

  it('migrates legacy flat defaults to per-device storage on load', async () => {
    localStorage.setItem(
      'reader:default:epub',
      JSON.stringify({
        ...EPUB_READER_DEFAULTS,
        fontSize: 20,
        maxColumnCount: 1,
      }),
    )

    const { load, effective } = useReaderSettings(4, 'epub')
    await load()

    const stored = readEpubDefaults()
    expect(stored.v).toBe(2)
    expect(stored.devices.mobile.fontSize).toBe(20)
    expect(stored.devices.tablet.fontSize).toBe(20)
    expect(stored.devices.desktop.fontSize).toBe(20)
    expect((effective.value as EpubReaderSettings).fontSize).toBe(20)
  })
})
