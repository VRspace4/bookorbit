import { describe, it, expect } from 'vitest'
import { ACCENT_IDS, type Accent } from '@bookorbit/types'
import {
  ACCENT_HUE,
  ACCENT_OPTIONS,
  ACCENT_PASTEL,
  ACCENT_PRIMARY,
  ACCENT_VIVID,
  DEFAULT_ACCENT,
  isPastelAccent,
  resolveAccent,
} from './theme-accent-meta'

describe('resolveAccent', () => {
  it('returns default accent for nullish or invalid values', () => {
    expect(resolveAccent(undefined)).toBe(DEFAULT_ACCENT)
    expect(resolveAccent(null)).toBe(DEFAULT_ACCENT)
    expect(resolveAccent('')).toBe(DEFAULT_ACCENT)
    expect(resolveAccent('not-a-real-accent')).toBe(DEFAULT_ACCENT)
  })

  it('returns valid accent values unchanged', () => {
    expect(resolveAccent('blue')).toBe('blue')
    expect(resolveAccent('mint')).toBe('mint')
  })
})

describe('isPastelAccent', () => {
  it('classifies accent tone correctly', () => {
    expect(isPastelAccent('mint')).toBe(true)
    expect(isPastelAccent('blue')).toBe(false)
    expect(isPastelAccent('unknown')).toBe(false)
  })
})

describe('accent option collections', () => {
  it('contains every accent id exactly once across all options', () => {
    const ids = ACCENT_OPTIONS.map((opt) => opt.id)
    expect(ids.length).toBe(ACCENT_IDS.length)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids)).toEqual(new Set(ACCENT_IDS))
  })

  it('partitions vivid and pastel options without overlap', () => {
    const vividIds = new Set(ACCENT_VIVID.map((opt) => opt.id))
    const pastelIds = new Set(ACCENT_PASTEL.map((opt) => opt.id))
    const overlap = [...vividIds].filter((id) => pastelIds.has(id))
    expect(overlap).toHaveLength(0)
    expect(vividIds.size + pastelIds.size).toBe(ACCENT_IDS.length)
  })

  it('keeps each tone group sorted by hue', () => {
    const vividHues = ACCENT_VIVID.map((opt) => ACCENT_HUE[opt.id])
    const pastelHues = ACCENT_PASTEL.map((opt) => ACCENT_HUE[opt.id])
    expect(vividHues).toEqual([...vividHues].sort((a, b) => a - b))
    expect(pastelHues).toEqual([...pastelHues].sort((a, b) => a - b))
  })
})

describe('accent metadata records', () => {
  it('defines hue and primary values for every accent', () => {
    for (const accent of ACCENT_IDS) {
      const hue = ACCENT_HUE[accent]
      const primary = ACCENT_PRIMARY[accent]
      expect(Number.isFinite(hue)).toBe(true)
      expect(primary).toHaveLength(4)
      expect(primary.every((v) => Number.isFinite(v))).toBe(true)
    }
  })

  it('primary tuples keep chroma non-negative in both modes', () => {
    for (const accent of ACCENT_IDS as readonly Accent[]) {
      const primary = ACCENT_PRIMARY[accent]
      expect(primary[1]).toBeGreaterThanOrEqual(0)
      expect(primary[3]).toBeGreaterThanOrEqual(0)
    }
  })
})
