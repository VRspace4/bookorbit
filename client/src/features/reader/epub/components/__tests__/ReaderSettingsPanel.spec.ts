import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
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

describe('ReaderSettingsPanel', () => {
  it('emits incremental updates from text controls', async () => {
    const wrapper = mount(ReaderSettingsPanel, {
      props: {
        state: makeState(),
      },
    })

    const textTab = wrapper.findAll('button').find((btn) => btn.text().includes('Text'))
    await textTab?.trigger('click')

    const plusButtons = wrapper.findAll('button').filter((btn) => btn.text() === '+')
    await plusButtons[0]!.trigger('click')

    expect(wrapper.emitted('update')?.[0]).toEqual([{ fontSize: 17 }])
  })

  it('emits appearance and layout toggles', async () => {
    const wrapper = mount(ReaderSettingsPanel, {
      props: {
        state: makeState({ isDark: false, flow: 'paginated' }),
      },
    })

    const darkButton = wrapper.findAll('button').find((btn) => btn.text().includes('Dark'))
    await darkButton?.trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ isDark: true }])

    const layoutTab = wrapper.findAll('button').find((btn) => btn.text().includes('Layout'))
    await layoutTab?.trigger('click')

    const scrolledButton = wrapper.findAll('button').find((btn) => btn.text().includes('Scrolled'))
    await scrolledButton?.trigger('click')

    expect(wrapper.emitted('update')?.[1]).toEqual([{ flow: 'scrolled' }])
  })

  it('emits fixed-layout EPUB spread updates', async () => {
    const wrapper = mount(ReaderSettingsPanel, {
      props: {
        state: makeState({ fixedLayoutSpread: 'auto' }),
        isFixedLayout: true,
      },
    })

    const layoutTab = wrapper.findAll('button').find((btn) => btn.text().includes('Layout'))
    await layoutTab?.trigger('click')

    const singlePageButton = wrapper.findAll('button').find((btn) => btn.text().includes('Single page'))
    await singlePageButton?.trigger('click')

    expect(wrapper.emitted('update')?.[0]).toEqual([{ fixedLayoutSpread: 'none' }])
  })

  it('hides fixed-layout spread controls for reflowable books', async () => {
    const wrapper = mount(ReaderSettingsPanel, {
      props: {
        state: makeState({ fixedLayoutSpread: 'auto' }),
      },
    })

    const layoutTab = wrapper.findAll('button').find((btn) => btn.text().includes('Layout'))
    await layoutTab?.trigger('click')

    expect(wrapper.text()).toContain('Reading flow')
    expect(wrapper.text()).toContain('Text columns')
    expect(wrapper.text()).not.toContain('Page spreads')
    expect(wrapper.text()).not.toContain('Single page')
  })

  it('shows only fixed-layout layout controls for fixed-layout books', async () => {
    const wrapper = mount(ReaderSettingsPanel, {
      props: {
        state: makeState({ fixedLayoutSpread: 'auto', flow: 'scrolled' }),
        isFixedLayout: true,
      },
    })

    expect(wrapper.findAll('button').some((btn) => btn.text().includes('Text'))).toBe(false)

    const layoutTab = wrapper.findAll('button').find((btn) => btn.text().includes('Layout'))
    await layoutTab?.trigger('click')

    expect(wrapper.text()).toContain('Page spreads')
    expect(wrapper.text()).toContain('Book default')
    expect(wrapper.text()).toContain('Single page')
    expect(wrapper.text()).not.toContain('Reading flow')
    expect(wrapper.text()).not.toContain('Scrolled')
    expect(wrapper.text()).not.toContain('Text columns')
  })
})
