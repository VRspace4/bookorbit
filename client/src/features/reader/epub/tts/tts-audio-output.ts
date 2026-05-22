export function createTtsOutputChain(ctx: AudioContext, volume: number): { gain: GainNode } {
  const gain = ctx.createGain()
  gain.gain.value = volume

  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.1

  gain.connect(limiter)
  limiter.connect(ctx.destination)
  return { gain }
}
