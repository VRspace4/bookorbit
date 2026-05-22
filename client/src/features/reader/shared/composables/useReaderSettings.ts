import { computed, onUnmounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/features/auth/composables/useAuth'
import { migrateLegacyThemeHighlightColors, resolveThemeHighlightColors } from '@/features/reader/epub/theme-highlight'
import {
  CBX_READER_DEFAULTS,
  type CbxReaderSettings,
  type EpubReaderSettings,
  type ReaderFormatGroup,
  type ReaderSettings,
  READER_GROUP_DEFAULTS,
  getFormatGroup,
} from '@bookorbit/types'

// -- Shared localStorage helpers --

const lsBookKey = (bookFileId: number) => `reader:book:${bookFileId}`
const lsDefaultKey = (group: ReaderFormatGroup) => `reader:default:${group}`

function readLs<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeLs(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function removeLs(key: string): void {
  localStorage.removeItem(key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const READER_SETTINGS_SYNC_DEBOUNCE_MS = 500

/** Settings from the in-reader cog and TTS panels — stored as account-wide format defaults. */
export const EPUB_GLOBAL_SETTING_KEYS = [
  'themeName',
  'isDark',
  'fontFamily',
  'fontSize',
  'lineHeight',
  'maxColumnCount',
  'gap',
  'maxInlineSize',
  'justify',
  'hyphenate',
  'flow',
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
  'ttsSkipBackSeconds',
  'ttsSkipForwardSeconds',
  'themeHighlightColors',
  'ttsSentenceHighlightColor',
  'ttsWordHighlightColor',
] as const satisfies readonly (keyof EpubReaderSettings)[]

export function isReaderSyncEnabled(user: { settings?: { syncReaderPreferences?: boolean } } | null | undefined): boolean {
  if (!user) return false
  return user.settings?.syncReaderPreferences !== false
}

function pickGlobalSettings(patch: Partial<ReaderSettings>): Partial<ReaderSettings> {
  const out: Partial<ReaderSettings> = {}
  for (const key of EPUB_GLOBAL_SETTING_KEYS) {
    if (key in patch) {
      ;(out as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key]
    }
  }
  return out
}

function stripGlobalSettingsFromDelta(delta: Partial<ReaderSettings>): Partial<ReaderSettings> {
  const next = { ...delta }
  for (const key of EPUB_GLOBAL_SETTING_KEYS) {
    delete (next as Record<string, unknown>)[key]
  }
  return next
}

function createDebouncedSync(syncFn: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false

  function schedule() {
    pending = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, READER_SETTINGS_SYNC_DEBOUNCE_MS)
  }

  async function flush() {
    if (!pending) return
    pending = false
    await syncFn().catch(() => {})
  }

  function cancel() {
    if (timer) clearTimeout(timer)
    timer = null
    pending = false
  }

  return { schedule, flush, cancel }
}

function sanitizeCbxPartialSettings(settings: unknown): Partial<CbxReaderSettings> | null {
  if (!isRecord(settings)) return null

  const out: Partial<CbxReaderSettings> = {}

  if (settings.fitMode === 'fit-page' || settings.fitMode === 'fit-width' || settings.fitMode === 'fit-height' || settings.fitMode === 'actual') {
    out.fitMode = settings.fitMode
  }
  if (settings.viewMode === 'single' || settings.viewMode === 'two-page') {
    out.viewMode = settings.viewMode
  }
  if (settings.scrollMode === 'paginated' || settings.scrollMode === 'infinite' || settings.scrollMode === 'long-strip') {
    out.scrollMode = settings.scrollMode
  }
  if (settings.direction === 'ltr' || settings.direction === 'rtl') {
    out.direction = settings.direction
  }
  if (settings.spreadAlignment === 'normal' || settings.spreadAlignment === 'shifted') {
    out.spreadAlignment = settings.spreadAlignment
  }
  if (typeof settings.forceTwoPage === 'boolean') {
    out.forceTwoPage = settings.forceTwoPage
  }
  if (settings.widePageSingletonMode === 'auto' || settings.widePageSingletonMode === 'disable') {
    out.widePageSingletonMode = settings.widePageSingletonMode
  }
  if (settings.bgColor === 'black' || settings.bgColor === 'gray' || settings.bgColor === 'white') {
    out.bgColor = settings.bgColor
  }

  return out
}

function sanitizeBookDelta(group: ReaderFormatGroup, raw: unknown): Partial<ReaderSettings> | null {
  if (group !== 'cbx') return isRecord(raw) ? (raw as Partial<ReaderSettings>) : null
  const sanitized = sanitizeCbxPartialSettings(raw)
  return sanitized as Partial<ReaderSettings> | null
}

function sanitizeDefaultSettings(group: ReaderFormatGroup, raw: unknown): ReaderSettings | null {
  if (group !== 'cbx') {
    if (!isRecord(raw)) return null
    if (group === 'epub') {
      const migrated = migrateLegacyThemeHighlightColors(raw as unknown as EpubReaderSettings)
      return migrated as ReaderSettings
    }
    return raw as unknown as ReaderSettings
  }

  const sanitized = sanitizeCbxPartialSettings(raw)
  if (!sanitized) return null

  return {
    ...CBX_READER_DEFAULTS,
    ...sanitized,
  } as ReaderSettings
}

function withResolvedEpubHighlights(settings: ReaderSettings): ReaderSettings {
  const epub = settings as EpubReaderSettings
  const resolved = resolveThemeHighlightColors(epub)
  return {
    ...epub,
    ...resolved,
  } as ReaderSettings
}

// -- Per-book settings (used inside the reader) --

export function useReaderSettings(bookFileId: number, format: string) {
  const group = getFormatGroup(format)
  const { user } = useAuth()

  // Only the fields the user explicitly changed for this book — not a full snapshot.
  const bookDelta = ref<Partial<ReaderSettings> | null>(null)
  const defaultSettings = ref<ReaderSettings | null>(null)
  const isCustomized = ref(false)

  const syncEnabled = computed(() => isReaderSyncEnabled(user.value))

  const bookSync = createDebouncedSync(async () => {
    if (!syncEnabled.value) return
    const settings = bookDelta.value
    if (!settings || Object.keys(settings).length === 0) return

    await api(`/api/v1/reader/preferences/${bookFileId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    })
  })

  const defaultSync = createDebouncedSync(async () => {
    if (!syncEnabled.value || !defaultSettings.value) return

    await api(`/api/v1/reader/defaults/${group}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: defaultSettings.value }),
    })
  })

  onUnmounted(() => {
    void bookSync.flush()
    void defaultSync.flush()
  })

  // Merge order: hardcoded fallback → format defaults → per-book delta
  const effective = computed<ReaderSettings>(() => {
    const merged = {
      ...(READER_GROUP_DEFAULTS[group] as ReaderSettings),
      ...(defaultSettings.value ?? undefined),
      ...(bookDelta.value ?? undefined),
    } as ReaderSettings

    if (group === 'epub') {
      return withResolvedEpubHighlights(merged)
    }

    return merged
  })

  async function load() {
    const lsBook = readLs<Partial<ReaderSettings>>(lsBookKey(bookFileId))
    const lsDefault = readLs<ReaderSettings>(lsDefaultKey(group))

    if (lsBook) {
      const sanitized = sanitizeBookDelta(group, lsBook)
      if (sanitized && Object.keys(sanitized).length > 0) {
        bookDelta.value = sanitized
        isCustomized.value = true
        if (!jsonEqual(lsBook, sanitized)) writeLs(lsBookKey(bookFileId), sanitized)
      } else {
        bookDelta.value = null
        isCustomized.value = false
        removeLs(lsBookKey(bookFileId))
      }
    }
    if (lsDefault) {
      const sanitized = sanitizeDefaultSettings(group, lsDefault)
      if (sanitized) {
        defaultSettings.value = sanitized
        if (!jsonEqual(lsDefault, sanitized)) writeLs(lsDefaultKey(group), sanitized)
      } else {
        defaultSettings.value = null
        removeLs(lsDefaultKey(group))
      }
    }

    migrateGlobalSettingsFromBookDelta()

    if (syncEnabled.value) {
      await syncFromDb()
      migrateGlobalSettingsFromBookDelta()
    }
  }

  function migrateGlobalSettingsFromBookDelta() {
    if (group !== 'epub' || !bookDelta.value) return

    const globalFromDelta = pickGlobalSettings(bookDelta.value)
    if (Object.keys(globalFromDelta).length === 0) return

    updateDefaultSettings(globalFromDelta)

    const nextDelta = stripGlobalSettingsFromDelta(bookDelta.value)
    if (Object.keys(nextDelta).length === 0) {
      bookDelta.value = null
      isCustomized.value = false
      removeLs(lsBookKey(bookFileId))
      if (syncEnabled.value) {
        api(`/api/v1/reader/preferences/${bookFileId}`, { method: 'DELETE' }).catch(() => {})
      }
      return
    }

    bookDelta.value = nextDelta
    isCustomized.value = true
    writeLs(lsBookKey(bookFileId), nextDelta)
    if (syncEnabled.value) {
      bookSync.schedule()
    }
  }

  async function syncFromDb() {
    const [prefRes, defRes] = await Promise.all([
      api(`/api/v1/reader/preferences/${bookFileId}`).then((r) => (r.ok ? r.json() : null)),
      api(`/api/v1/reader/defaults`).then((r) => (r.ok ? r.json() : null)),
    ])

    if (prefRes?.settings) {
      const sanitized = sanitizeBookDelta(group, prefRes.settings)
      if (sanitized && Object.keys(sanitized).length > 0) {
        bookDelta.value = sanitized
        isCustomized.value = true
        writeLs(lsBookKey(bookFileId), sanitized)
      } else {
        bookDelta.value = null
        isCustomized.value = false
        removeLs(lsBookKey(bookFileId))
      }
    }
    if (defRes?.[group]) {
      const sanitized = sanitizeDefaultSettings(group, defRes[group])
      if (sanitized) {
        defaultSettings.value = sanitized
        writeLs(lsDefaultKey(group), sanitized)
      } else {
        defaultSettings.value = null
        removeLs(lsDefaultKey(group))
      }
    }
  }

  // Merges only the changed field(s) into the existing delta — never saves a full snapshot.
  function updateBookSettings(patch: Partial<ReaderSettings>) {
    const next = { ...(bookDelta.value ?? undefined), ...patch } as Partial<ReaderSettings>
    bookDelta.value = next
    isCustomized.value = Object.keys(next).length > 0
    writeLs(lsBookKey(bookFileId), next)

    if (syncEnabled.value) {
      bookSync.schedule()
    }
  }

  function resetBookSettings() {
    bookSync.cancel()
    bookDelta.value = null
    isCustomized.value = false
    removeLs(lsBookKey(bookFileId))

    if (syncEnabled.value) {
      api(`/api/v1/reader/preferences/${bookFileId}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  function updateDefaultSettings(patch: Partial<ReaderSettings>) {
    const current = defaultSettings.value ?? READER_GROUP_DEFAULTS[group]
    const next = { ...current, ...patch } as ReaderSettings
    defaultSettings.value = group === 'epub' ? withResolvedEpubHighlights(next) : next
    writeLs(lsDefaultKey(group), defaultSettings.value)

    if (syncEnabled.value) {
      defaultSync.schedule()
    }
  }

  // Saves appearance, text, layout, and TTS settings as account-wide defaults (not per-book).
  function updateGlobalSettings(patch: Partial<ReaderSettings>) {
    const globalPatch = pickGlobalSettings(patch)
    if (Object.keys(globalPatch).length === 0) return

    updateDefaultSettings(globalPatch)

    if (bookDelta.value) {
      const nextDelta = stripGlobalSettingsFromDelta(bookDelta.value)
      if (Object.keys(nextDelta).length === 0) {
        resetBookSettings()
      } else if (!jsonEqual(nextDelta, bookDelta.value)) {
        bookDelta.value = nextDelta
        isCustomized.value = true
        writeLs(lsBookKey(bookFileId), nextDelta)
        if (syncEnabled.value) {
          bookSync.schedule()
        }
      }
    }
  }

  function resetDefaultSettings() {
    defaultSync.cancel()
    defaultSettings.value = null
    removeLs(lsDefaultKey(group))

    if (syncEnabled.value) {
      api(`/api/v1/reader/defaults/${group}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  return {
    effective,
    bookDelta,
    isCustomized,
    load,
    updateBookSettings,
    updateGlobalSettings,
    resetBookSettings,
    updateDefaultSettings,
    resetDefaultSettings,
  }
}

// -- Format default settings (used in the settings UI) --

export function useReaderDefaultSettings<T extends ReaderSettings>(format: string) {
  const group = getFormatGroup(format)
  const { user } = useAuth()

  const settings = ref<T | null>(null)
  const syncEnabled = computed(() => isReaderSyncEnabled(user.value))
  const effective = computed<T>(() => (settings.value ?? READER_GROUP_DEFAULTS[group]) as T)

  const defaultSync = createDebouncedSync(async () => {
    if (!syncEnabled.value || !settings.value) return

    await api(`/api/v1/reader/defaults/${group}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: settings.value }),
    })
  })

  onUnmounted(() => {
    void defaultSync.flush()
  })

  async function load() {
    const ls = readLs<T>(lsDefaultKey(group))
    if (ls) {
      const sanitized = sanitizeDefaultSettings(group, ls)
      if (sanitized) {
        settings.value = sanitized as T
        if (!jsonEqual(ls, sanitized)) writeLs(lsDefaultKey(group), sanitized)
      } else {
        settings.value = null
        removeLs(lsDefaultKey(group))
      }
    }

    if (syncEnabled.value) {
      const res = await api('/api/v1/reader/defaults')
      if (res.ok) {
        const data = await res.json()
        if (data[group]) {
          const sanitized = sanitizeDefaultSettings(group, data[group])
          if (sanitized) {
            settings.value = sanitized as T
            writeLs(lsDefaultKey(group), sanitized)
          } else {
            settings.value = null
            removeLs(lsDefaultKey(group))
          }
        }
      }
    }
  }

  function update(patch: Partial<T>) {
    const next = { ...effective.value, ...patch } as T
    settings.value = group === 'epub' ? (withResolvedEpubHighlights(next) as T) : next
    writeLs(lsDefaultKey(group), settings.value)

    if (syncEnabled.value) {
      defaultSync.schedule()
    }
  }

  function reset() {
    defaultSync.cancel()
    settings.value = null
    removeLs(lsDefaultKey(group))

    if (syncEnabled.value) {
      api(`/api/v1/reader/defaults/${group}`, { method: 'DELETE' }).catch(() => {})
    }
    toast.success('Settings reset to defaults')
  }

  return { effective, load, update, reset }
}

/** Upload locally cached reader defaults and per-book overrides after enabling account sync. */
export async function pushLocalReaderPreferencesToBackend(): Promise<void> {
  const { user } = useAuth()
  if (!isReaderSyncEnabled(user.value)) return

  const defaultGroups: ReaderFormatGroup[] = ['epub', 'pdf', 'cbx', 'audio']
  await Promise.all(
    defaultGroups.map(async (group) => {
      const settings = readLs<ReaderSettings>(lsDefaultKey(group))
      if (!settings) return
      await api(`/api/v1/reader/defaults/${group}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      }).catch(() => {})
    }),
  )

  const bookPrefix = 'reader:book:'
  await Promise.all(
    Object.keys(localStorage)
      .filter((key) => key.startsWith(bookPrefix))
      .map(async (key) => {
        const bookFileId = Number(key.slice(bookPrefix.length))
        if (!Number.isFinite(bookFileId)) return
        const settings = readLs<Partial<ReaderSettings>>(key)
        if (!settings || Object.keys(settings).length === 0) return
        await api(`/api/v1/reader/preferences/${bookFileId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings }),
        }).catch(() => {})
      }),
  )
}
