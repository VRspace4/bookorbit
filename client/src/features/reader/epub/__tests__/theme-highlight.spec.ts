import { describe, expect, it } from 'vitest'
import { EPUB_READER_DEFAULTS, type EpubReaderSettings } from '@bookorbit/types'
import {
  buildThemeHighlightPatch,
  buildThemeSwitchHighlightPatch,
  migrateLegacyThemeHighlightColors,
  resolveThemeHighlightColors,
} from '../theme-highlight'

describe('theme-highlight', () => {
  const baseSettings: EpubReaderSettings = {
    ...EPUB_READER_DEFAULTS,
    themeName: 'default',
  }

  it('uses theme defaults when no overrides exist', () => {
    expect(resolveThemeHighlightColors(baseSettings)).toEqual({
      ttsSentenceHighlightColor: '#4f6f7d',
      ttsWordHighlightColor: '#0f4f5f',
    })
  })

  it('uses per-theme overrides when present', () => {
    const settings: EpubReaderSettings = {
      ...baseSettings,
      themeHighlightColors: {
        sepia: {
          ttsSentenceHighlightColor: '#aa0000',
          ttsWordHighlightColor: '#bb0000',
        },
      },
      themeName: 'sepia',
    }

    expect(resolveThemeHighlightColors(settings)).toEqual({
      ttsSentenceHighlightColor: '#aa0000',
      ttsWordHighlightColor: '#bb0000',
    })
  })

  it('migrates legacy global highlight colors into the active theme', () => {
    const legacy: EpubReaderSettings = {
      ...baseSettings,
      ttsSentenceHighlightColor: '#111111',
      ttsWordHighlightColor: '#222222',
    }

    expect(migrateLegacyThemeHighlightColors(legacy)).toEqual({
      ...legacy,
      themeHighlightColors: {
        default: {
          ttsSentenceHighlightColor: '#111111',
          ttsWordHighlightColor: '#222222',
        },
      },
    })
  })

  it('builds a per-theme highlight patch for the active theme', () => {
    expect(
      buildThemeHighlightPatch(baseSettings, {
        ttsSentenceHighlightColor: '#123456',
      }),
    ).toEqual({
      themeHighlightColors: {
        default: {
          ttsSentenceHighlightColor: '#123456',
          ttsWordHighlightColor: '#0f4f5f',
        },
      },
      ttsSentenceHighlightColor: '#123456',
      ttsWordHighlightColor: '#0f4f5f',
    })
  })

  it('builds highlight values when switching themes', () => {
    const settings: EpubReaderSettings = {
      ...baseSettings,
      themeHighlightColors: {
        sepia: {
          ttsSentenceHighlightColor: '#aa0000',
          ttsWordHighlightColor: '#bb0000',
        },
      },
    }

    expect(buildThemeSwitchHighlightPatch(settings, 'sepia')).toEqual({
      themeName: 'sepia',
      ttsSentenceHighlightColor: '#aa0000',
      ttsWordHighlightColor: '#bb0000',
    })
  })
})
