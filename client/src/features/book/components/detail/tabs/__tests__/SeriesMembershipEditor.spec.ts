import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditableSeriesMembership } from '../../../../composables/useMetadataEditor'
import SeriesMembershipEditor from '../SeriesMembershipEditor.vue'

function mountHost(initialMemberships: EditableSeriesMembership[] = []) {
  const Host = defineComponent({
    components: { SeriesMembershipEditor },
    setup() {
      const memberships = ref<EditableSeriesMembership[]>(initialMemberships)
      const searchFn = vi.fn<(query: string) => Promise<string[]>>().mockResolvedValue([])
      return { memberships, searchFn }
    },
    template: '<SeriesMembershipEditor v-model="memberships" :search-fn="searchFn" />',
  })

  const attachTo = document.createElement('div')
  document.body.appendChild(attachTo)

  return mount(Host, {
    attachTo,
    global: {
      stubs: {
        teleport: true,
      },
    },
  })
}

describe('SeriesMembershipEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('keeps the series name input focused while typing into an empty series row', async () => {
    const wrapper = mountHost()
    const input = wrapper.get<HTMLInputElement>('input[type="text"]')

    input.element.focus()
    await input.trigger('focus')
    expect(document.activeElement).toBe(input.element)

    await input.setValue('D')
    await nextTick()

    const updatedInput = wrapper.get<HTMLInputElement>('input[type="text"]')
    expect(updatedInput.element).toBe(input.element)
    expect(document.activeElement).toBe(input.element)

    await updatedInput.setValue('Dune')
    await nextTick()

    const finalInput = wrapper.get<HTMLInputElement>('input[type="text"]')
    expect(finalInput.element).toBe(input.element)
    expect(document.activeElement).toBe(input.element)
    expect((wrapper.vm as { memberships: EditableSeriesMembership[] }).memberships).toEqual([{ seriesName: 'Dune', seriesIndex: null }])
  })
})
