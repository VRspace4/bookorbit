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

export function resolveThemeHighlightColors(
  settings: Pick<EpubReaderSettings, 'themeName' | 'themeHighlightColors' | 'ttsSentenceHighlightColor' | 'ttsWordHighlightColor'>,
  themeName = settings.themeName,
): ThemeHighlightColors {
  const defaults = getThemeHighlightDefaults(themeName)
  const overrides = settings.themeHighlightColors?.[themeName]
  const useTopLevelFallback = themeName === settings.themeName

  return {
    ttsSentenceHighlightColor:
      overrides?.ttsSentenceHighlightColor ??
      (useTopLevelFallback ? settings.ttsSentenceHighlightColor : undefined) ??
      defaults.ttsSentenceHighlightColor,
    ttsWordHighlightColor:
      overrides?.ttsWordHighlightColor ?? (useTopLevelFallback ? settings.ttsWordHighlightColor : undefined) ?? defaults.ttsWordHighlightColor,
  }
}

export function mergeThemeHighlightColorMaps(
  base: Record<string, ThemeHighlightColors> | undefined,
  patch: Record<string, Partial<ThemeHighlightColors>> | undefined,
): Record<string, ThemeHighlightColors> | undefined {
  if (!patch) return base

  const merged: Record<string, ThemeHighlightColors> = { ...(base ?? {}) }
  for (const [themeName, colors] of Object.entries(patch)) {
    const defaults = getThemeHighlightDefaults(themeName)
    const current = merged[themeName]
    merged[themeName] = {
      ttsSentenceHighlightColor: colors.ttsSentenceHighlightColor ?? current?.ttsSentenceHighlightColor ?? defaults.ttsSentenceHighlightColor,
      ttsWordHighlightColor: colors.ttsWordHighlightColor ?? current?.ttsWordHighlightColor ?? defaults.ttsWordHighlightColor,
    }
  }

  return merged
}

/** Migrate legacy global highlight colors into per-theme overrides. */
export function migrateLegacyThemeHighlightColors(settings: EpubReaderSettings): EpubReaderSettings {
  const defaults = getThemeHighlightDefaults(settings.themeName)
  const hasLegacyOverrides =
    settings.ttsSentenceHighlightColor !== defaults.ttsSentenceHighlightColor || settings.ttsWordHighlightColor !== defaults.ttsWordHighlightColor

  const normalizedMap = mergeThemeHighlightColorMaps(settings.themeHighlightColors, {
    ...(settings.themeHighlightColors ?? {}),
    ...(hasLegacyOverrides
      ? {
          [settings.themeName]: {
            ttsSentenceHighlightColor: settings.ttsSentenceHighlightColor,
            ttsWordHighlightColor: settings.ttsWordHighlightColor,
          },
        }
      : {}),
  })

  if (!normalizedMap) return settings

  const resolved = resolveThemeHighlightColors({
    ...settings,
    themeHighlightColors: normalizedMap,
  })

  return {
    ...settings,
    themeHighlightColors: normalizedMap,
    ...resolved,
  }
}

export function buildThemeHighlightPatch(
  settings: EpubReaderSettings,
  patch: Partial<ThemeHighlightColors>,
  themeName = settings.themeName,
): Partial<EpubReaderSettings> {
  const current = resolveThemeHighlightColors(settings, themeName)
  const next: ThemeHighlightColors = {
    ttsSentenceHighlightColor: patch.ttsSentenceHighlightColor ?? current.ttsSentenceHighlightColor,
    ttsWordHighlightColor: patch.ttsWordHighlightColor ?? current.ttsWordHighlightColor,
  }

  return {
    themeHighlightColors: mergeThemeHighlightColorMaps(settings.themeHighlightColors, {
      [themeName]: next,
    }),
    ...(themeName === settings.themeName ? next : {}),
  }
}

export function buildThemeSwitchHighlightPatch(settings: EpubReaderSettings, themeName: string): Partial<EpubReaderSettings> {
  const resolved = resolveThemeHighlightColors({ ...settings, themeName }, themeName)
  return {
    themeName,
    ...resolved,
  }
}
