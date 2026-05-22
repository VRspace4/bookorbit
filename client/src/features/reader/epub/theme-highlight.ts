import {
  DEFAULT_TTS_SENTENCE_HIGHLIGHT_COLOR,
  DEFAULT_TTS_WORD_HIGHLIGHT_COLOR,
  type EpubReaderSettings,
  type ThemeHighlightColors,
} from '@bookorbit/types'
import { themes } from './constants/themes'

export function getThemeHighlightDefaults(themeName: string): ThemeHighlightColors {
  const theme = themes.find((entry) => entry.name === themeName)
  return {
    ttsSentenceHighlightColor: theme?.ttsSentenceHighlightColor ?? DEFAULT_TTS_SENTENCE_HIGHLIGHT_COLOR,
    ttsWordHighlightColor: theme?.ttsWordHighlightColor ?? DEFAULT_TTS_WORD_HIGHLIGHT_COLOR,
  }
}

export function resolveThemeHighlightColors(settings: Pick<EpubReaderSettings, 'themeName' | 'themeHighlightColors'>): ThemeHighlightColors {
  const defaults = getThemeHighlightDefaults(settings.themeName)
  const overrides = settings.themeHighlightColors?.[settings.themeName]
  return {
    ttsSentenceHighlightColor: overrides?.ttsSentenceHighlightColor ?? defaults.ttsSentenceHighlightColor,
    ttsWordHighlightColor: overrides?.ttsWordHighlightColor ?? defaults.ttsWordHighlightColor,
  }
}

/** Migrate legacy global highlight colors into per-theme overrides. */
export function migrateLegacyThemeHighlightColors(settings: EpubReaderSettings): EpubReaderSettings {
  if (settings.themeHighlightColors) return settings

  const defaults = getThemeHighlightDefaults(settings.themeName)
  const hasLegacyOverrides =
    settings.ttsSentenceHighlightColor !== defaults.ttsSentenceHighlightColor || settings.ttsWordHighlightColor !== defaults.ttsWordHighlightColor

  if (!hasLegacyOverrides) return settings

  return {
    ...settings,
    themeHighlightColors: {
      [settings.themeName]: {
        ttsSentenceHighlightColor: settings.ttsSentenceHighlightColor,
        ttsWordHighlightColor: settings.ttsWordHighlightColor,
      },
    },
  }
}

export function buildThemeHighlightPatch(
  settings: EpubReaderSettings,
  patch: Partial<ThemeHighlightColors>,
  themeName = settings.themeName,
): Partial<EpubReaderSettings> {
  const current = resolveThemeHighlightColors({ ...settings, themeName })
  const next: ThemeHighlightColors = {
    ttsSentenceHighlightColor: patch.ttsSentenceHighlightColor ?? current.ttsSentenceHighlightColor,
    ttsWordHighlightColor: patch.ttsWordHighlightColor ?? current.ttsWordHighlightColor,
  }

  return {
    themeHighlightColors: {
      ...settings.themeHighlightColors,
      [themeName]: next,
    },
    ...(themeName === settings.themeName ? next : {}),
  }
}

export function buildThemeSwitchHighlightPatch(settings: EpubReaderSettings, themeName: string): Partial<EpubReaderSettings> {
  const resolved = resolveThemeHighlightColors({ ...settings, themeName })
  return {
    themeName,
    ...resolved,
  }
}
