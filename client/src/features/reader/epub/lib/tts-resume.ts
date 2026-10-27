export interface TtsResumePromptInput {
  savedSectionIndex: number | null | undefined
  currentSectionIndex: number
  /**
   * Whether the saved TTS word is currently visible in the reading viewport.
   * Only meaningful when saved and current sections match.
   * Pass `false` when the user has paged/scrolled away within the same section.
   * Omit/`null` when visibility is unknown (falls back to section-only checks).
   */
  savedWordVisibleInViewport?: boolean | null
}

/**
 * True when the user is not currently viewing the last TTS reading position
 * (different section, or same section but a different page/viewport).
 */
export function isAwayFromLastTtsPosition(input: TtsResumePromptInput): boolean {
  if (typeof input.savedSectionIndex !== 'number') return false
  if (input.savedSectionIndex !== input.currentSectionIndex) return true
  return input.savedWordVisibleInViewport === false
}

/** @deprecated Prefer isAwayFromLastTtsPosition */
export function shouldPromptTtsResume(input: TtsResumePromptInput): boolean {
  return isAwayFromLastTtsPosition(input)
}
