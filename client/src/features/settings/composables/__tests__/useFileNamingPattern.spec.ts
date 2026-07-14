import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(msg: string) => void>(),
    error: vi.fn<(msg: string) => void>(),
  },
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: { value: [] },
    fetchLibraries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

import { api } from '@/lib/api'
import { toast } from 'vue-sonner'
import { useFileNamingPattern, previewPath, previewDownloadName } from '../useFileNamingPattern'

const mockApi = vi.mocked(api)
const mockToastSuccess = vi.mocked(toast.success)
const mockToastError = vi.mocked(toast.error)

function makeOkResponse(data: object): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(data),
  } as unknown as Response
}

function makeErrorResponse(): Response {
  return { ok: false, status: 500, json: vi.fn<() => Promise<unknown>>() } as unknown as Response
}

describe('useFileNamingPattern - cross-platform sanitization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchCrossPlatformSanitization', () => {
    it('sets crossPlatformSanitizationEnabled to true on successful response', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({ enabled: true }))
      const { crossPlatformSanitizationEnabled, fetchCrossPlatformSanitization } = useFileNamingPattern()

      await fetchCrossPlatformSanitization()
      await flushPromises()

      expect(crossPlatformSanitizationEnabled.value).toBe(true)
    })

    it('sets crossPlatformSanitizationEnabled to false on successful response with false', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({ enabled: false }))
      const { crossPlatformSanitizationEnabled, fetchCrossPlatformSanitization } = useFileNamingPattern()

      await fetchCrossPlatformSanitization()
      await flushPromises()

      expect(crossPlatformSanitizationEnabled.value).toBe(false)
    })

    it('does not change value when response is not ok', async () => {
      mockApi.mockResolvedValueOnce(makeErrorResponse())
      const { crossPlatformSanitizationEnabled, fetchCrossPlatformSanitization } = useFileNamingPattern()

      await fetchCrossPlatformSanitization()
      await flushPromises()

      expect(crossPlatformSanitizationEnabled.value).toBe(true)
    })

    it('resets loadingCrossPlatformSanitization to false after success', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({ enabled: true }))
      const { loadingCrossPlatformSanitization, fetchCrossPlatformSanitization } = useFileNamingPattern()

      await fetchCrossPlatformSanitization()
      await flushPromises()

      expect(loadingCrossPlatformSanitization.value).toBe(false)
    })

    it('resets loadingCrossPlatformSanitization to false after fetch throws', async () => {
      mockApi.mockRejectedValueOnce(new Error('network error'))
      const { loadingCrossPlatformSanitization, fetchCrossPlatformSanitization } = useFileNamingPattern()

      await fetchCrossPlatformSanitization().catch(() => undefined)
      await flushPromises()

      expect(loadingCrossPlatformSanitization.value).toBe(false)
    })
  })

  describe('saveCrossPlatformSanitization', () => {
    it('calls api PUT with the correct URL and body', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({}))
      const { crossPlatformSanitizationEnabled, saveCrossPlatformSanitization } = useFileNamingPattern()
      crossPlatformSanitizationEnabled.value = true

      await saveCrossPlatformSanitization()
      await flushPromises()

      expect(mockApi).toHaveBeenCalledWith(
        '/api/v1/app-settings/cross-platform-path-sanitization',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ enabled: true }),
        }),
      )
    })

    it('calls api PUT with enabled: false when flag is false', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({}))
      const { crossPlatformSanitizationEnabled, saveCrossPlatformSanitization } = useFileNamingPattern()
      crossPlatformSanitizationEnabled.value = false

      await saveCrossPlatformSanitization()
      await flushPromises()

      expect(mockApi).toHaveBeenCalledWith(
        '/api/v1/app-settings/cross-platform-path-sanitization',
        expect.objectContaining({
          body: JSON.stringify({ enabled: false }),
        }),
      )
    })

    it('shows success toast when response is ok', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({}))
      const { saveCrossPlatformSanitization } = useFileNamingPattern()

      await saveCrossPlatformSanitization()
      await flushPromises()

      expect(mockToastSuccess).toHaveBeenCalledWith('Cross-platform path sanitization saved')
    })

    it('shows error toast when response is not ok', async () => {
      mockApi.mockResolvedValueOnce(makeErrorResponse())
      const { saveCrossPlatformSanitization } = useFileNamingPattern()

      await saveCrossPlatformSanitization()
      await flushPromises()

      expect(mockToastError).toHaveBeenCalledWith('Failed to save cross-platform path sanitization')
    })

    it('resets savingCrossPlatformSanitization to false after success', async () => {
      mockApi.mockResolvedValueOnce(makeOkResponse({}))
      const { savingCrossPlatformSanitization, saveCrossPlatformSanitization } = useFileNamingPattern()

      await saveCrossPlatformSanitization()
      await flushPromises()

      expect(savingCrossPlatformSanitization.value).toBe(false)
    })

    it('resets savingCrossPlatformSanitization to false after api throws', async () => {
      mockApi.mockRejectedValueOnce(new Error('network error'))
      const { savingCrossPlatformSanitization, saveCrossPlatformSanitization } = useFileNamingPattern()

      await saveCrossPlatformSanitization().catch(() => undefined)
      await flushPromises()

      expect(savingCrossPlatformSanitization.value).toBe(false)
    })
  })
})

describe('previewPath', () => {
  it('returns a path starting with / for a valid pattern', () => {
    const result = previewPath('{authors}/{title}')
    expect(result).toMatch(/^\//)
    expect(result).toContain('.epub')
  })

  it('returns a fallback path when pattern is empty', () => {
    const result = previewPath('')
    expect(result).toBe('/neuromancer.epub')
  })

  it('prepends / when resolved path does not start with /', () => {
    const result = previewPath('{title}')
    expect(result.startsWith('/')).toBe(true)
  })
})

describe('previewDownloadName', () => {
  it('returns a filename string for a valid pattern', () => {
    const result = previewDownloadName('{title}')
    expect(result).toBeTruthy()
    expect(result).toContain('.epub')
  })

  it('uses originalFilename default when pattern is empty', () => {
    const result = previewDownloadName('')
    expect(result).toBeTruthy()
  })
})
