import { describe, expect, it } from 'vitest'
import { clampXaiTtsSpeed, xaiPlaybackRateForDesired, XAI_TTS_SPEED_MAX, XAI_TTS_SPEED_MIN } from '../xai-tts-speed'

describe('xai-tts-speed', () => {
  it('clamps to the official xAI range', () => {
    expect(clampXaiTtsSpeed(1)).toBe(1)
    expect(clampXaiTtsSpeed(1.2)).toBe(1.2)
    expect(clampXaiTtsSpeed(0.5)).toBe(XAI_TTS_SPEED_MIN)
    expect(clampXaiTtsSpeed(2)).toBe(XAI_TTS_SPEED_MAX)
    expect(clampXaiTtsSpeed(Number.NaN)).toBe(1)
  })

  it('keeps residual playbackRate at 1 when desired is in range', () => {
    expect(xaiPlaybackRateForDesired(1.25)).toBeCloseTo(1, 5)
    expect(xaiPlaybackRateForDesired(1.5)).toBeCloseTo(1, 5)
  })

  it('applies residual playbackRate outside the API range', () => {
    expect(xaiPlaybackRateForDesired(2)).toBeCloseTo(2 / 1.5, 5)
    expect(xaiPlaybackRateForDesired(0.5)).toBeCloseTo(0.5 / 0.7, 5)
    expect(xaiPlaybackRateForDesired(3)).toBeCloseTo(3 / 1.5, 5)
  })
})
