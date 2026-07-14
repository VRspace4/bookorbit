import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ZlibSearchModal from '../ZlibSearchModal.vue'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit & { _isRetry?: boolean }) => Promise<Response>>())
const routerPushMock = vi.hoisted(() => vi.fn<(to: unknown) => void>())
const toastMocks = vi.hoisted(() => ({
  error: vi.fn<(message: string) => void>(),
  info: vi.fn<(message: string) => void>(),
  success: vi.fn<(message: string) => void>(),
}))
const annaNativeResolverMock = vi.hoisted(() => ({
  isAvailable: vi.fn<() => boolean>(),
  resolve: vi.fn<(url: string) => Promise<string[]>>(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock }),
}))

vi.mock('vue-sonner', () => ({
  toast: toastMocks,
}))

vi.mock('@/features/zlib/lib/anna-native-resolver', () => ({
  isAnnaMirrorResolverAvailable: annaNativeResolverMock.isAvailable,
  resolveAnnaMirrors: annaNativeResolverMock.resolve,
}))

function makeResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(payload),
  } as unknown as Response
}

describe('ZlibSearchModal', () => {
  beforeEach(() => {
    apiMock.mockReset()
    routerPushMock.mockReset()
    toastMocks.error.mockReset()
    toastMocks.info.mockReset()
    toastMocks.success.mockReset()
    annaNativeResolverMock.isAvailable.mockReset()
    annaNativeResolverMock.resolve.mockReset()
    annaNativeResolverMock.isAvailable.mockReturnValue(false)
  })

  it('waits for the Search button before executing a search', async () => {
    apiMock.mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/v1/zlib/status') {
        return Promise.resolve(makeResponse({ connected: true, remainingToday: 8, isAtLimit: false }))
      }
      if (url.startsWith('/api/v1/zlib/search?')) {
        return Promise.resolve(makeResponse({ total: 0, books: [] }))
      }
      return Promise.resolve(makeResponse({}))
    })

    const wrapper = mount(ZlibSearchModal, {
      global: { stubs: { Teleport: true } },
    })
    const searchCalls = () => apiMock.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/zlib/search?'))

    await flushPromises()
    await wrapper.find('input[type="text"]').setValue('public domain')
    await flushPromises()
    expect(searchCalls()).toHaveLength(0)

    await wrapper.find('select').setValue('pdf')
    await flushPromises()
    expect(searchCalls()).toHaveLength(0)

    await wrapper
      .findAll('button')
      .find((button) => button.text() === "Anna's Archive")!
      .trigger('click')
    await flushPromises()
    expect(searchCalls()).toHaveLength(0)

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Search')!
      .trigger('click')
    await flushPromises()

    expect(searchCalls()).toHaveLength(1)
    expect(String(searchCalls()[0]?.[0])).toContain('source=anna')
    expect(String(searchCalls()[0]?.[0])).toContain('format=pdf')
  })

  it('searches Anna and hides Z-Library queue actions when Anna is selected', async () => {
    apiMock.mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/v1/zlib/status') {
        return Promise.resolve(makeResponse({ connected: true, remainingToday: 8, isAtLimit: false }))
      }
      if (url.startsWith('/api/v1/zlib/search?')) {
        return Promise.resolve(
          makeResponse({
            total: 1,
            books: [
              {
                id: '426e8513e507b07dc42c54fd0f1b4048',
                hash: '426e8513e507b07dc42c54fd0f1b4048',
                title: 'The Public Domain',
                author: 'Stephen Fishman',
                year: '2023',
                language: 'english',
                extension: 'pdf',
                filesize: 1024,
                cover: '',
                source: 'anna',
                detailUrl: 'https://annas-archive.gl/md5/426e8513e507b07dc42c54fd0f1b4048',
              },
            ],
          }),
        )
      }
      return Promise.resolve(makeResponse({}))
    })

    const wrapper = mount(ZlibSearchModal, {
      global: { stubs: { Teleport: true } },
    })

    await nextTick()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === "Anna's Archive")!
      .trigger('click')
    await wrapper.find('input[type="text"]').setValue('public domain')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Search')!
      .trigger('click')
    await nextTick()
    await nextTick()

    const searchCall = apiMock.mock.calls.find(([url]) => String(url).startsWith('/api/v1/zlib/search?'))
    expect(String(searchCall?.[0])).toContain('source=anna')
    expect(wrapper.text()).toContain('The Public Domain')
    expect(wrapper.text()).toContain('Add')
    expect(wrapper.text()).not.toContain('Queue')
  })

  it('shows an Anna search handoff when search returns browser verification', async () => {
    const challengeUrl = 'https://annas-archive.gl/search?index=&page=1&sort=&display=&q=public+domain'
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    apiMock.mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/v1/zlib/status') {
        return Promise.resolve(makeResponse({ connected: true, remainingToday: 8, isAtLimit: false }))
      }
      if (url.startsWith('/api/v1/zlib/search?')) {
        return Promise.resolve(
          makeResponse(
            {
              code: 'ANNA_ARCHIVE_CHALLENGE',
              message: "Anna's Archive requires browser verification before search results are available.",
              challengeUrl,
            },
            503,
          ),
        )
      }
      return Promise.resolve(makeResponse({}))
    })

    const wrapper = mount(ZlibSearchModal, {
      global: { stubs: { Teleport: true } },
    })

    await nextTick()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === "Anna's Archive")!
      .trigger('click')
    await wrapper.find('input[type="text"]').setValue('public domain')
    await wrapper.find('select').setValue('pdf')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Search')!
      .trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Browser verification required')
    expect(wrapper.text()).toContain("Anna's Archive blocked this search before results were available.")
    expect(toastMocks.info).not.toHaveBeenCalled()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === "Open Anna's Archive")!
      .trigger('click')

    expect(openSpy).toHaveBeenCalledWith(challengeUrl, '_blank', 'noopener,noreferrer')
    openSpy.mockRestore()
  })

  it('offers an Anna source-page handoff when download resolution hits browser verification', async () => {
    const detailUrl = 'https://annas-archive.gl/md5/426e8513e507b07dc42c54fd0f1b4048'
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    apiMock.mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/v1/zlib/status') {
        return Promise.resolve(makeResponse({ connected: true, remainingToday: 8, isAtLimit: false }))
      }
      if (url.startsWith('/api/v1/zlib/search?')) {
        return Promise.resolve(
          makeResponse({
            total: 1,
            books: [
              {
                id: '426e8513e507b07dc42c54fd0f1b4048',
                hash: '426e8513e507b07dc42c54fd0f1b4048',
                title: 'The Public Domain',
                author: 'Stephen Fishman',
                year: '2023',
                language: 'english',
                extension: 'pdf',
                filesize: 1024,
                cover: '',
                source: 'anna',
                detailUrl,
              },
            ],
          }),
        )
      }
      if (url === '/api/v1/zlib/download') {
        return Promise.resolve(makeResponse({ message: 'browser verification required' }, 503))
      }
      return Promise.resolve(makeResponse({}))
    })

    const wrapper = mount(ZlibSearchModal, {
      global: { stubs: { Teleport: true } },
    })

    await nextTick()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === "Anna's Archive")!
      .trigger('click')
    await wrapper.find('input[type="text"]').setValue('public domain')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Search')!
      .trigger('click')
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Add')!
      .trigger('click')
    await flushPromises()

    expect(toastMocks.info).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Browser verification required')
    expect(wrapper.text()).toContain('Open source')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Open source')!
      .trigger('click')

    expect(openSpy).toHaveBeenCalledWith(
      'https://annas-archive.gl/slow_download/426e8513e507b07dc42c54fd0f1b4048/0/0',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()
  })

  it('uses the native Anna mirror resolver to retry Add after browser verification', async () => {
    const slowUrl = 'https://annas-archive.gl/slow_download/426e8513e507b07dc42c54fd0f1b4048/0/0'
    annaNativeResolverMock.isAvailable.mockReturnValue(true)
    annaNativeResolverMock.resolve.mockResolvedValue(['https://download.example/book.epub'])

    apiMock.mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/v1/zlib/status') {
        return Promise.resolve(makeResponse({ connected: true, remainingToday: 8, isAtLimit: false }))
      }
      if (url.startsWith('/api/v1/zlib/search?')) {
        return Promise.resolve(
          makeResponse({
            total: 1,
            books: [
              {
                id: '426e8513e507b07dc42c54fd0f1b4048',
                hash: '426e8513e507b07dc42c54fd0f1b4048',
                title: 'The Public Domain',
                author: 'Stephen Fishman',
                year: '2023',
                language: 'english',
                extension: 'pdf',
                filesize: 1024,
                cover: '',
                source: 'anna',
                detailUrl: 'https://annas-archive.gl/md5/426e8513e507b07dc42c54fd0f1b4048',
              },
            ],
          }),
        )
      }
      if (url === '/api/v1/zlib/download') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { mirrorUrls?: string[] }
        if (!body.mirrorUrls) {
          return Promise.resolve(
            makeResponse(
              {
                code: 'ANNA_ARCHIVE_CHALLENGE',
                message: 'Anna’s Archive is requiring a browser challenge before download mirrors are available.',
                challengeUrl: slowUrl,
              },
              503,
            ),
          )
        }
        return Promise.resolve(makeResponse({ bookDockId: 42 }))
      }
      return Promise.resolve(makeResponse({}))
    })

    const wrapper = mount(ZlibSearchModal, {
      global: { stubs: { Teleport: true } },
    })

    await nextTick()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === "Anna's Archive")!
      .trigger('click')
    await wrapper.find('input[type="text"]').setValue('public domain')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Search')!
      .trigger('click')
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Add')!
      .trigger('click')
    await flushPromises()

    const downloadCalls = apiMock.mock.calls.filter(([url]) => String(url) === '/api/v1/zlib/download')
    expect(annaNativeResolverMock.resolve).toHaveBeenCalledWith(slowUrl)
    expect(downloadCalls).toHaveLength(2)
    expect(JSON.parse(String(downloadCalls[1]?.[1]?.body))).toMatchObject({
      mirrorUrls: ['https://download.example/book.epub'],
    })
    expect(toastMocks.success).toHaveBeenCalledWith('"The Public Domain" added to Book Dock')
  })
})
