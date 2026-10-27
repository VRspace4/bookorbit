import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import ReaderSettingsPanel from '../ReaderSettingsPanel.vue'
import type { ReaderState } from '../../composables/useReaderState'

function makeState(overrides: Partial<ReaderState> = {}): ReaderState {
  return {
    fontSize: 16,
    lineHeight: 1.5,
    fontFamily: null,
    maxColumnCount: 2,
    gap: 0.05,
    maxInlineSize: 720,
    maxBlockSize: 1440,
    justify: true,
    hyphenate: true,
    isDark: false,
    themeName: 'default',
    flow: 'paginated',
    fixedLayoutSpread: 'auto',
    ...overrides,
  }
}

function isSelected(classes: string) {
  return classes.includes('ring-1') && classes.includes('ring-border') && classes.includes('shadow-sm')
}

describe('ReaderSettingsPanel reactivity', () => {
  it('updates selected appearance after parent applies emit', async () => {
    const isDark = ref(false)
    const themeName = ref('default')
    const flow = ref<'paginated' | 'scrolled'>('paginated')
    const fontSize = ref(16)

    const state = computed<ReaderState>(() =>
      makeState({
        isDark: isDark.value,
        themeName: themeName.value,
        flow: flow.value,
        fontSize: fontSize.value,
      }),
    )

    const Parent = defineComponent({
      setup() {
        function applyUpdate(partial: Partial<ReaderState>) {
          if (partial.isDark !== undefined) isDark.value = partial.isDark
          if (partial.themeName !== undefined) themeName.value = partial.themeName
          if (partial.flow !== undefined) flow.value = partial.flow
          if (partial.fontSize !== undefined) fontSize.value = partial.fontSize
        }
        return () =>
          h(ReaderSettingsPanel, {
            state: state.value,
            onUpdate: applyUpdate,
          })
      },
    })

    const wrapper = mount(Parent)
    await flushPromises()

    const darkBtn = wrapper.findAll('button').find((b) => b.text().includes('Dark'))!
    const lightBtn = wrapper.findAll('button').find((b) => b.text().includes('Light'))!
    expect(isSelected(lightBtn.classes().join(' '))).toBe(true)
    expect(isSelected(darkBtn.classes().join(' '))).toBe(false)

    await darkBtn.trigger('click')
    await nextTick()
    await flushPromises()

    expect(isDark.value).toBe(true)
    expect(isSelected(wrapper.findAll('button').find((b) => b.text().includes('Dark'))!.classes().join(' '))).toBe(true)
    expect(isSelected(wrapper.findAll('button').find((b) => b.text().includes('Light'))!.classes().join(' '))).toBe(false)

    const layoutTab = wrapper.findAll('button').find((b) => b.text().includes('Layout'))!
    await layoutTab.trigger('click')
    await nextTick()

    const scrolled = wrapper.findAll('button').find((b) => b.text().includes('Scrolled'))!
    await scrolled.trigger('click')
    await nextTick()
    await flushPromises()

    expect(flow.value).toBe('scrolled')
    expect(isSelected(wrapper.findAll('button').find((b) => b.text().includes('Scrolled'))!.classes().join(' '))).toBe(true)
  })

  it('optimistically updates selection even when parent is slow to sync props', async () => {
    const state = ref(makeState({ isDark: false, fontSize: 16 }))
    const emitted: Partial<ReaderState>[] = []

    const Parent = defineComponent({
      setup() {
        return () =>
          h(ReaderSettingsPanel, {
            state: state.value,
            onUpdate: (partial: Partial<ReaderState>) => {
              emitted.push(partial)
              // Intentionally do not update parent state yet
            },
          })
      },
    })

    const wrapper = mount(Parent)
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text().includes('Dark'))!.trigger('click')
    await nextTick()

    expect(emitted).toEqual([{ isDark: true }])
    expect(state.value.isDark).toBe(false)
    expect(isSelected(wrapper.findAll('button').find((b) => b.text().includes('Dark'))!.classes().join(' '))).toBe(true)
    expect(isSelected(wrapper.findAll('button').find((b) => b.text().includes('Light'))!.classes().join(' '))).toBe(false)

    const textTab = wrapper.findAll('button').find((b) => b.text().includes('Text'))!
    await textTab.trigger('click')
    await nextTick()
    await wrapper.findAll('button').filter((b) => b.text() === '+')[0]!.trigger('click')
    await nextTick()

    expect(emitted[1]).toEqual({ fontSize: 17 })
    expect(wrapper.text()).toContain('17px')
  })
})
