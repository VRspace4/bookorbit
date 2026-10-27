/** Official xAI / Grok TTS speaking-rate multiplier range. */
export const XAI_TTS_SPEED_MIN = 0.7
export const XAI_TTS_SPEED_MAX = 1.5

/** Clamp a desired reading rate to the range accepted by the xAI TTS API. */
export function clampXaiTtsSpeed(rate: number): number {
  if (!Number.isFinite(rate)) return 1
  return Math.min(XAI_TTS_SPEED_MAX, Math.max(XAI_TTS_SPEED_MIN, rate))
}

/**
 * Client-side residual after synthesis speed is clamped.
 * Example: desired 2.0 with synth 1.5 → playbackRate ≈ 1.333.
 */
export function xaiPlaybackRateForDesired(desiredRate: number): number {
  const desired = Number.isFinite(desiredRate) && desiredRate > 0 ? desiredRate : 1
  const synth = clampXaiTtsSpeed(desired)
  return desired / synth
}
