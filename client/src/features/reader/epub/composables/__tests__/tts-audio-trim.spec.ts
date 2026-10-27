import { describe, expect, it } from 'vitest'
import { adjustAzureBoundaries, trimAudioBufferSilence } from '../useEpubTts'

class FakeAudioBuffer {
  numberOfChannels = 1
  length: number
  sampleRate: number
  duration: number
  private readonly channels: Float32Array[]

  constructor(data: Float32Array, sampleRate = 1000) {
    this.channels = [data]
    this.length = data.length
    this.sampleRate = sampleRate
    this.duration = data.length / sampleRate
  }

  getChannelData(channel: number) {
    return this.channels[channel] ?? this.channels[0]!
  }

  copyToChannel(source: Float32Array, channel: number) {
    this.channels[channel]?.set(source)
  }
}

class FakeAudioContext {
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeAudioBuffer(new Float32Array(length), sampleRate) as unknown as AudioBuffer
  }
}

describe('tts audio trim helpers', () => {
  it('reports speech offset for leading silence in untrimmed buffers', () => {
    const buffer = new FakeAudioBuffer(Float32Array.from([0, 0, 0, 0.05, 0.04, 0, 0])) as unknown as AudioBuffer
    const ctx = new FakeAudioContext() as unknown as AudioContext
    const trimmed = trimAudioBufferSilence(ctx, buffer)

    expect(trimmed.trimStartSec).toBe(0)
    expect(trimmed.speechOffsetSec).toBeCloseTo(0.003, 5)
    expect(trimmed.buffer).toBe(buffer)
  })

  it('shifts Azure boundaries when leading silence is trimmed', () => {
    const boundaries = [
      { offset: 0, audioOffsetSec: 0 },
      { offset: 5, audioOffsetSec: 0.42 },
      { offset: 11, audioOffsetSec: 0.78 },
    ]

    const adjusted = adjustAzureBoundaries(boundaries, 0.13, 0.06)

    expect(adjusted[0]?.audioOffsetSec).toBeCloseTo(0.06, 5)
    expect(adjusted[1]?.audioOffsetSec).toBeCloseTo(0.29, 5)
    expect(adjusted[2]?.audioOffsetSec).toBeCloseTo(0.65, 5)
  })

  it('keeps boundary times monotonic after adjustment', () => {
    const boundaries = [
      { offset: 0, audioOffsetSec: 0 },
      { offset: 0, audioOffsetSec: 0.01 },
      { offset: 4, audioOffsetSec: 0.2 },
    ]

    const adjusted = adjustAzureBoundaries(boundaries, 0.1, 0.06)

    expect(adjusted[0]?.audioOffsetSec).toBeCloseTo(0.06, 5)
    expect(adjusted[1]?.audioOffsetSec).toBeGreaterThanOrEqual(adjusted[0]!.audioOffsetSec)
    expect(adjusted[2]?.audioOffsetSec).toBeGreaterThan(adjusted[1]!.audioOffsetSec)
  })
})