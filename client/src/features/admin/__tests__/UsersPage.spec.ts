import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import UsersPage from '../UsersPage.vue'

const { apiMock, routeState, permState } = vi.hoisted(() => ({
  apiMock: vi.fn<(input: string) => Promise<unknown>>(),
  routeState: { query: { tab: 'users' as string } },
  permState: { isSuperuser: true },
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({
    replace: vi.fn<() => void>(),
  }),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    isSuperuser: computed(() => permState.isSuperuser),
    hasPermission: vi.fn<(name: string) => boolean>(() => true),
  }),
}))

describe('UsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permState.isSuperuser = true
    routeState.query = { tab: 'users' }
    apiMock.mockImplementation(async (input: string) => {
      if (input.startsWith('/api/v1/users')) {
        return { ok: true, json: async () => ({ users: [] }) }
      }
      if (input === '/api/v1/libraries') {
        return { ok: true, json: async () => ({ libraries: [] }) }
      }
      if (input === '/api/v1/app-settings/default-library-access') {
        return { ok: true, json: async () => ({ libraryIds: [] }) }
      }
      return { ok: false, json: async () => ({}) }
    })
  })

  it('shows a single create user CTA when embedded on users tab', async () => {
    const wrapper = shallowMount(UsersPage, { props: { embedded: true } })
    await flushPromises()

    const createButtons = wrapper.findAll('button').filter((button) => button.text().includes('Create user'))
    expect(createButtons).toHaveLength(1)
    expect(wrapper.find('user-form-drawer-stub').exists()).toBe(false)

    await createButtons[0]?.trigger('click')

    expect(wrapper.find('user-form-drawer-stub').exists()).toBe(true)
  })
})
