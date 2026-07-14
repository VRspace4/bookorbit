import { describe, expect, it } from 'vitest'
import { hexToHsl, hslToHex, normalizeHex } from '../color-utils'

describe('color-utils', () => {
  it('normalizes hex values', () => {
    expect(normalizeHex('FDE68A')).toBe('#fde68a')
    expect(normalizeHex('#FDE68A')).toBe('#fde68a')
    expect(normalizeHex('bad')).toBeNull()
  })

  it('round-trips common colors through hsl', () => {
    expect(hslToHex(0, 0, 100)).toBe('#ffffff')
    expect(hslToHex(0, 0, 0)).toBe('#000000')
    expect(hslToHex(0, 100, 50)).toBe('#ff0000')

    const yellow = hexToHsl('#fde68a')
    expect(yellow).not.toBeNull()
    expect(hslToHex(yellow!.h, yellow!.s, yellow!.l)).toBe('#fde68a')
  })
})
