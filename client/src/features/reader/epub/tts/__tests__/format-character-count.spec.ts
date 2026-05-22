import { describe, expect, it } from 'vitest'
import { formatTtsCharacterCount } from '../format-character-count'

describe('formatTtsCharacterCount', () => {
  it('formats small counts as plain numbers', () => {
    expect(formatTtsCharacterCount(0)).toBe('0')
    expect(formatTtsCharacterCount(42)).toBe('42')
    expect(formatTtsCharacterCount(999)).toBe('999')
  })

  it('formats thousands with K or k', () => {
    expect(formatTtsCharacterCount(500)).toBe('0.5K')
    expect(formatTtsCharacterCount(1000)).toBe('1K')
    expect(formatTtsCharacterCount(1500)).toBe('1.5K')
    expect(formatTtsCharacterCount(100_000)).toBe('100k')
  })

  it('formats millions with M', () => {
    expect(formatTtsCharacterCount(1_000_000)).toBe('1M')
    expect(formatTtsCharacterCount(1_500_000)).toBe('1.5M')
  })
})
