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
    attachTo: document.body,
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

function pickerOptions(_wrapper: ReturnType<typeof mountControls>) {
  return document.body.querySelectorAll('button[role="option"]')
}

describe('TtsControls', () => {
  it('shows provider context from settings without word metrics', () => {
    const wrapper = mountControls({
      settings: { ...EPUB_READER_DEFAULTS, ttsProvider: 'azure' } as EpubReaderSettings,
    })

    expect(wrapper.text()).not.toContain('5 / 10')
    expect(wrapper.text()).toContain('Azure')
    expect(wrapper.find('[style*="width: 50%"]').exists()).toBe(true)
  })

  it('shows the selected engine even when runtime provider is stale', () => {
    const wrapper = mountControls({
      provider: 'xai',
      settings: { ...EPUB_READER_DEFAULTS, ttsProvider: 'kokoro' } as EpubReaderSettings,
    })

    expect(wrapper.text()).toContain('Kokoro')
    expect(wrapper.text()).not.toContain('xAI')
  })

  it('shows Kokoro from settings when runtime provider is unset', () => {
    const wrapper = mountControls({ provider: null })

    expect(wrapper.text()).toContain('Kokoro')
  })

  it('shows the selected engine when runtime provider is unset and settings pick Azure', () => {
    const wrapper = mountControls({
      provider: null,
      settings: { ...EPUB_READER_DEFAULTS, ttsProvider: 'azure' } as EpubReaderSettings,
    })

    expect(wrapper.text()).toContain('Azure')
  })

  it('shows a loading spinner instead of pause while prefetching audio', () => {
    const wrapper = mountControls({ status: 'loading' })

    expect(wrapper.get('button[aria-label="Loading TTS"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('button[aria-label="Pause TTS"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Start TTS"]').exists()).toBe(false)
  })

  it('emits playback controls and opens settings from the gear', async () => {
    const wrapper = mountControls()

    await wrapper.get('button[aria-label="Pause TTS"]').trigger('click')
    await wrapper.get('button[aria-label="Skip back 15 seconds"]').trigger('click')
    await wrapper.get('button[aria-label="Skip forward 30 seconds"]').trigger('click')
    await wrapper.get('button[aria-label="TTS settings"]').trigger('click')

    expect(wrapper.emitted('pause')?.length).toBe(1)
    expect(wrapper.emitted('skipBack')?.length).toBe(1)
    expect(wrapper.emitted('skipForward')?.length).toBe(1)
    expect(wrapper.emitted('toggleSettings')?.length).toBe(1)
    expect(wrapper.find('button[aria-label="Stop TTS"]').exists()).toBe(false)
  })

  it('opens an engine picker instead of the full settings sheet', async () => {
    const wrapper = mountControls({
      settings: { ...EPUB_READER_DEFAULTS, ttsProvider: 'kokoro' } as EpubReaderSettings,
    })

    await wrapper.get('button[aria-label="Choose TTS engine"]').trigger('click')
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(wrapper.emitted('toggleSettings')).toBeUndefined()
    const labels = [...pickerOptions(wrapper)].map((button) => button.textContent)
    expect(labels).toContain('Google')
    expect(labels).toContain('GPT')

    wrapper.unmount()
  })

  it('emits updateProvider when an engine is chosen', async () => {
    const wrapper = mountControls()

    await wrapper.get('button[aria-label="Choose TTS engine"]').trigger('click')
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const azureOption = [...pickerOptions(wrapper)].find((button) => button.textContent === 'Azure')
    expect(azureOption).toBeDefined()
    await azureOption!.click()

    expect(wrapper.emitted('updateProvider')?.[0]).toEqual(['azure'])
    wrapper.unmount()
  })

  it('opens a speed picker with 1x–3x presets', async () => {
    const wrapper = mountControls({
      settings: { ...EPUB_READER_DEFAULTS, ttsRate: 1.5 } as EpubReaderSettings,
    })

    await wrapper.get('button[aria-label="Choose reading speed"]').trigger('click')
    await new Promise((resolve) => requestAnimationFrame(resolve))

    const speedOptions = [...new Set([...pickerOptions(wrapper)].map((button) => button.textContent))]
    expect(speedOptions).toEqual(['1x', '1.25x', '1.5x', '1.75x', '2x', '2.25x', '2.5x', '2.75x', '3x'])

    wrapper.unmount()
  })

  it('emits updateRate when a speed is chosen', async () => {
    const wrapper = mountControls()

    await wrapper.get('button[aria-label="Choose reading speed"]').trigger('click')
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const speedOption = [...pickerOptions(wrapper)].find((button) => button.textContent === '2x')
    expect(speedOption).toBeDefined()
    await speedOption!.click()

    expect(wrapper.emitted('updateRate')?.[0]).toEqual([2])
    wrapper.unmount()
  })
})
