import { describe, expect, it } from 'vitest'
import { isAwayFromLastTtsPosition } from '../tts-resume'

describe('isAwayFromLastTtsPosition', () => {
  it('returns false when there is no saved TTS position', () => {
    expect(
      isAwayFromLastTtsPosition({
        savedSectionIndex: null,
        currentSectionIndex: 3,
      }),
    ).toBe(false)
    expect(
      isAwayFromLastTtsPosition({
        savedSectionIndex: undefined,
        currentSectionIndex: 3,
      }),
    ).toBe(false)
  })

  it('returns false when the user is on the same section and the saved word is still in view', () => {
    expect(
      isAwayFromLastTtsPosition({
        savedSectionIndex: 5,
        currentSectionIndex: 5,
        savedWordVisibleInViewport: true,
      }),
    ).toBe(false)
  })

  it('returns false when same section and visibility is unknown', () => {
    expect(
      isAwayFromLastTtsPosition({
        savedSectionIndex: 5,
        currentSectionIndex: 5,
      }),
    ).toBe(false)
    expect(
      isAwayFromLastTtsPosition({
        savedSectionIndex: 5,
        currentSectionIndex: 5,
        savedWordVisibleInViewport: null,
      }),
    ).toBe(false)
  })

  it('returns true when the saved section differs from the current section', () => {
    expect(
      isAwayFromLastTtsPosition({
        savedSectionIndex: 2,
        currentSectionIndex: 7,
      }),
    ).toBe(true)
    expect(
      isAwayFromLastTtsPosition({
        savedSectionIndex: 0,
        currentSectionIndex: 1,
        savedWordVisibleInViewport: true,
      }),
    ).toBe(true)
  })

  it('returns true when same section but the saved word is not on the current page/viewport', () => {
    expect(
      isAwayFromLastTtsPosition({
        savedSectionIndex: 4,
        currentSectionIndex: 4,
        savedWordVisibleInViewport: false,
      }),
    ).toBe(true)
  })
})
