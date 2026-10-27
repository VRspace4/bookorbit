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

/**
 * Resume an AudioContext without hanging forever.
 *
 * Some mobile browsers (notably Opera on Android) leave `AudioContext.resume()`
 * pending indefinitely when the context stays suspended. TTS playback must not
 * block on that promise — synthesis/decode can still proceed, and `source.start`
 * often works after a real user gesture even if state remains "suspended".
 */
export async function resumeAudioContext(ctx: AudioContext, timeoutMs = 400): Promise<void> {
  if (ctx.state === 'running') return

  // Kick a zero-length buffer — helps unlock Web Audio on some mobile browsers.
  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 22050)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(0)
  } catch {
    // ignore unlock failures
  }

  try {
    await Promise.race([
      ctx.resume().then(() => undefined),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeoutMs)
      }),
    ])
  } catch {
    // ignore resume rejections; caller proceeds best-effort
  }
}
