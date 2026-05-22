import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { EPUB_READER_DEFAULTS, type EpubReaderSettings } from '@bookorbit/types'
import TtsControls from '../TtsControls.vue'

type TtsControlsProps = {
  status: 'idle' | 'loading' | 'speaking' | 'paused' | 'done' | 'error'
  progress: number
  activeIndex: number
  wordCount: number
  provider: 'browser' | 'azure' | 'gcp-chirp3' | 'xai' | 'kokoro' | 'gpt-4o-mini-tts' | null
  settings: EpubReaderSettings
}

function mountControls(overrides: Partial<TtsControlsProps> = {}) {
  return mount(TtsControls, {
    props: {
      status: 'speaking',
      progress: 0.5,
      activeIndex: 4,
      wordCount: 10,
      provider: 'azure',
      settings: EPUB_READER_DEFAULTS as EpubReaderSettings,
      ...overrides,
    },
  })
}

describe('TtsControls', () => {
  it('shows progress and provider context', () => {
    const wrapper = mountControls()

    expect(wrapper.text()).toContain('5 / 10')
    expect(wrapper.text()).toContain('Azure')
    expect(wrapper.find('[style*="width: 50%"]').exists()).toBe(true)
  })

  it('emits playback controls', async () => {
    const wrapper = mountControls()

    await wrapper.get('button[aria-label="Pause TTS"]').trigger('click')
    await wrapper.get('button[aria-label="Skip back 15 seconds"]').trigger('click')
    await wrapper.get('button[aria-label="Skip forward 30 seconds"]').trigger('click')
    await wrapper.get('button[aria-label="TTS settings"]').trigger('click')
    await wrapper.get('button[aria-label="Stop TTS"]').trigger('click')

    expect(wrapper.emitted('pause')?.length).toBe(1)
    expect(wrapper.emitted('skipBack')?.length).toBe(1)
    expect(wrapper.emitted('skipForward')?.length).toBe(1)
    expect(wrapper.emitted('toggleSettings')?.length).toBe(1)
    expect(wrapper.emitted('stop')?.length).toBe(1)
  })
})
