import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TtsResumeDialog from '../TtsResumeDialog.vue'

describe('TtsResumeDialog', () => {
  const props = {
    savedSectionLabel: 'Chapter 3',
    currentSectionLabel: 'Chapter 7',
  }

  it('emits continueSaved, startHere, and cancel actions', async () => {
    const wrapper = mount(TtsResumeDialog, {
      props,
      global: {
        stubs: {
          teleport: true,
        },
      },
    })

    const buttons = wrapper.findAll('button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    await buttons[2]!.trigger('click')

    expect(wrapper.emitted('continueSaved')?.length).toBe(1)
    expect(wrapper.emitted('startHere')?.length).toBe(1)
    expect(wrapper.emitted('cancel')?.length).toBe(1)
  })

  it('shows section labels in the dialog copy', () => {
    const wrapper = mount(TtsResumeDialog, {
      props,
      global: {
        stubs: {
          teleport: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Chapter 3')
    expect(wrapper.text()).toContain('Chapter 7')
    expect(wrapper.text()).toContain('Continue from Chapter 3')
    expect(wrapper.text()).toContain('Read from here instead')
  })

  it('emits cancel when backdrop is clicked', async () => {
    const wrapper = mount(TtsResumeDialog, {
      props,
      global: {
        stubs: {
          teleport: true,
        },
      },
    })

    await wrapper.get('.fixed.inset-0').trigger('click')
    expect(wrapper.emitted('cancel')?.length).toBe(1)
  })
})
