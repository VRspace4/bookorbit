import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { EPUB_READER_DEFAULTS, type EpubReaderSettings } from '@bookorbit/types'
import TtsSettingsPanel from '../TtsSettingsPanel.vue'
import { useTtsUsage } from '../../tts/tts-usage'

function mountPanel(settings: Partial<EpubReaderSettings> = {}) {
  return mount(TtsSettingsPanel, {
    props: {
      settings: {
        ...EPUB_READER_DEFAULTS,
        ...settings,
      } as EpubReaderSettings,
    },
  })
}

describe('TtsSettingsPanel', () => {
  it('shows monthly character pills beside engine names', () => {
    const { setUsage } = useTtsUsage()
    setUsage({ kokoro: 1500, xai: 100_000 })

    const wrapper = mountPanel({ ttsProvider: 'kokoro' })

    expect(wrapper.text()).toContain('Kokoro')
    expect(wrapper.text()).toContain('1.5K')
    expect(wrapper.text()).toContain('100k')
  })

  it('exposes speed control for Kokoro', async () => {
    const wrapper = mountPanel({ ttsProvider: 'kokoro', ttsRate: 1.4 })

    expect(wrapper.text()).toContain('Rate 1.4x')

    const rateInput = wrapper.findAll('input[type="range"]').find((input) => input.attributes('min') === '0.5' && input.attributes('max') === '2')

    expect(rateInput).toBeTruthy()
    await rateInput!.setValue('1.7')

    const updates = wrapper.emitted('update') ?? []
    expect(updates[updates.length - 1]).toEqual([{ ttsRate: 1.7 }])
  })
})
