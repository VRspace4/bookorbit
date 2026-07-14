import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TtsHighlightColorPanel from '../TtsHighlightColorPanel.vue'

function mountPanel(target: 'sentence' | 'word' = 'sentence') {
  return mount(TtsHighlightColorPanel, {
    props: {
      target,
      sentenceColor: '#4f6f7d',
      wordColor: '#0f4f5f',
    },
    attachTo: document.body,
  })
}

describe('TtsHighlightColorPanel', () => {
  it('emits live color updates for the active target', async () => {
    const wrapper = mountPanel('sentence')

    const sentenceButton = wrapper.findAll('button').find((button) => button.text() === 'Sentence')
    await sentenceButton!.trigger('click')

    await wrapper.get('[aria-label="Blue"]').trigger('click')

    const updates = wrapper.emitted('update') ?? []
    expect(updates[updates.length - 1]).toEqual([{ ttsSentenceHighlightColor: '#93c5fd' }])
  })

  it('emits word color updates after switching targets', async () => {
    const wrapper = mountPanel('word')

    const wordButton = wrapper.findAll('button').find((button) => button.text() === 'Word')
    await wordButton!.trigger('click')

    await wrapper.get('[aria-label="Blue"]').trigger('click')

    const updates = wrapper.emitted('update') ?? []
    expect(updates[updates.length - 1]).toEqual([{ ttsWordHighlightColor: '#93c5fd' }])
  })

  it('emits target changes from the toggle buttons', async () => {
    const wrapper = mountPanel('sentence')

    const wordButton = wrapper.findAll('button').find((button) => button.text() === 'Word')
    await wordButton!.trigger('click')

    expect(wrapper.emitted('update:target')?.[0]).toEqual(['word'])
  })

  it('toggles preset colors when re-selecting the active target', async () => {
    const wrapper = mountPanel('sentence')

    expect(wrapper.find('[aria-label="Blue"]').exists()).toBe(false)

    const sentenceButton = wrapper.findAll('button').find((button) => button.text() === 'Sentence')
    await sentenceButton!.trigger('click')
    expect(wrapper.find('[aria-label="Blue"]').exists()).toBe(true)

    await sentenceButton!.trigger('click')
    expect(wrapper.find('[aria-label="Blue"]').exists()).toBe(false)
  })

  it('toggles the custom color picker from the preview swatch', async () => {
    const wrapper = mountPanel('sentence')

    expect(wrapper.find('[aria-label="Saturation and lightness"]').exists()).toBe(true)

    await wrapper.get('[aria-label="Toggle custom color picker"]').trigger('click')
    expect(wrapper.find('[aria-label="Saturation and lightness"]').exists()).toBe(false)

    await wrapper.get('[aria-label="Toggle custom color picker"]').trigger('click')
    expect(wrapper.find('[aria-label="Saturation and lightness"]').exists()).toBe(true)
  })

  it('copies the other highlight color when using the eyedropper', async () => {
    const wrapper = mountPanel('word')

    await wrapper.get('[aria-label="Copy color from Sentence highlight"]').trigger('click')

    const updates = wrapper.emitted('update') ?? []
    expect(updates[updates.length - 1]).toEqual([{ ttsWordHighlightColor: '#4f6f7d' }])
  })
})
