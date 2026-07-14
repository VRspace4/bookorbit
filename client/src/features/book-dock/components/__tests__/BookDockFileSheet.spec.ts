import { shallowMount } from '@vue/test-utils'
import { defineComponent, reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDockFile } from '@bookorbit/types'
import BookDockFileSheet from '../BookDockFileSheet.vue'

const mocks = vi.hoisted(() => ({
  fetchLibraries: vi.fn<() => Promise<void>>(),
  loadProviders: vi.fn<() => Promise<void>>(),
  search: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock('../../composables/useBookDockDetail', () => ({
  useBookDockDetail: () => ({
    saved: ref(false),
    saveError: ref(null),
    saveMetadata: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
    setTarget: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
    discardFile: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    coverUrl: (id: number) => `/api/v1/book-dock/files/${id}/cover`,
  }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref([]),
    fetchLibraries: mocks.fetchLibraries,
  }),
}))

vi.mock('@/features/book/composables/useMetadataSearch', () => ({
  useMetadataSearch: () => ({
    filteredResults: ref([]),
    providerCounts: reactive({}),
    isStreaming: ref(false),
    hasSearched: ref(false),
    providers: ref([]),
    selectedProviders: ref([]),
    loadProviders: mocks.loadProviders,
    search: mocks.search,
    toggleProvider: vi.fn<(...args: unknown[]) => void>(),
    selectFieldRuleProviders: vi.fn<() => void>(),
    clearProviderFilter: vi.fn<() => void>(),
  }),
}))

const MetadataSearchPanelStub = defineComponent({
  name: 'MetadataSearchPanel',
  props: {
    searchDefaults: {
      type: Object,
      required: true,
    },
  },
  template: '<div data-test="metadata-search-panel" />',
})

function makeFile(overrides: Partial<BookDockFile> = {}): BookDockFile {
  return {
    id: 1,
    fileName: 'Batman #007.cbz',
    fileSize: 1024,
    format: 'cbz',
    status: 'ready',
    embeddedMetadata: {},
    selectedMetadata: null,
    fetchedMetadata: null,
    targetLibraryId: null,
    targetFolderId: null,
    confidence: null,
    fetchedMetadataSources: null,
    errorMessage: null,
    metadataEditedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function mountSheet(file: BookDockFile) {
  return shallowMount(BookDockFileSheet, {
    props: { file },
    global: {
      stubs: {
        MetadataSearchPanel: MetadataSearchPanelStub,
        MetadataDiffPanel: true,
        BookDockStatusBadge: true,
      },
    },
  })
}

async function openSearchAndReadDefaults(file: BookDockFile): Promise<Record<string, string | undefined>> {
  const wrapper = mountSheet(file)
  const searchButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Search')
  expect(searchButton).toBeDefined()
  await searchButton!.trigger('click')
  return wrapper.getComponent(MetadataSearchPanelStub).props('searchDefaults') as Record<string, string | undefined>
}

describe('BookDockFileSheet metadata search defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchLibraries.mockResolvedValue(undefined)
    mocks.loadProviders.mockResolvedValue(undefined)
  })

  it.each([
    {
      fileName: 'Batman #007.cbz',
      embeddedMetadata: {},
      expectedTitle: 'Batman #007',
    },
    {
      fileName: 'Saga.Volume.1.cbz',
      embeddedMetadata: { title: '   ' },
      expectedTitle: 'Saga.Volume.1',
    },
    {
      fileName: 'fallback.cbz',
      embeddedMetadata: { title: '  Canonical Title  ' },
      expectedTitle: 'Canonical Title',
    },
  ])('uses "$expectedTitle" for $fileName', async ({ fileName, embeddedMetadata, expectedTitle }) => {
    const defaults = await openSearchAndReadDefaults(makeFile({ fileName, embeddedMetadata }))

    expect(defaults).toEqual({
      title: expectedTitle,
      author: undefined,
      isbn: undefined,
    })
  })

  it('prefers user-selected metadata and keeps the other extracted search defaults', async () => {
    const defaults = await openSearchAndReadDefaults(
      makeFile({
        fileName: 'fallback.cbz',
        embeddedMetadata: { title: 'Embedded Title' },
        selectedMetadata: {
          title: '  User Edited Title  ',
          authors: ['Primary Author', 'Second Author'],
          isbn13: '9781401284770',
        },
      }),
    )

    expect(defaults).toEqual({
      title: 'User Edited Title',
      author: 'Primary Author',
      isbn: '9781401284770',
    })
  })
})
