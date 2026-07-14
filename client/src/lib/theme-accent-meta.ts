import { ACCENT_IDS, type Accent } from '@bookorbit/types'

export type AccentTone = 'vivid' | 'pastel'
export type AccentPrimaryDef = readonly [lightL: number, lightC: number, darkL: number, darkC: number]

export interface AccentOption {
  id: Accent
  label: string
  color: string
}

interface AccentMetaDefinition {
  label: string
  color: string
  tone: AccentTone
  hue: number
  primary: AccentPrimaryDef
}

const ACCENT_META_BY_ID: Record<Accent, AccentMetaDefinition> = {
  white: { label: 'White', color: '#fafafa', tone: 'vivid', hue: 0, primary: [0.2, 0, 0.985, 0] },
  grey: { label: 'Grey', color: '#737373', tone: 'pastel', hue: 0, primary: [0.55, 0, 0.75, 0] },
  rose: { label: 'Rose', color: '#e11d48', tone: 'vivid', hue: 15, primary: [0.57, 0.24, 0.73, 0.2] },
  orange: { label: 'Orange', color: '#ea580c', tone: 'vivid', hue: 42, primary: [0.64, 0.22, 0.78, 0.18] },
  amber: { label: 'Amber', color: '#d97706', tone: 'vivid', hue: 70, primary: [0.72, 0.17, 0.82, 0.17] },
  yellow: { label: 'Yellow', color: '#ca8a04', tone: 'vivid', hue: 95, primary: [0.75, 0.18, 0.84, 0.16] },
  lime: { label: 'Lime', color: '#65a30d', tone: 'vivid', hue: 118, primary: [0.64, 0.2, 0.77, 0.18] },
  green: { label: 'Green', color: '#16a34a', tone: 'vivid', hue: 142, primary: [0.527, 0.18, 0.72, 0.18] },
  emerald: { label: 'Emerald', color: '#059669', tone: 'vivid', hue: 162, primary: [0.52, 0.17, 0.72, 0.15] },
  teal: { label: 'Teal', color: '#0d9488', tone: 'vivid', hue: 180, primary: [0.52, 0.18, 0.74, 0.16] },
  cyan: { label: 'Cyan', color: '#0891b2', tone: 'vivid', hue: 197, primary: [0.52, 0.2, 0.75, 0.17] },
  sky: { label: 'Sky', color: '#0284c7', tone: 'vivid', hue: 213, primary: [0.54, 0.21, 0.75, 0.18] },
  blue: { label: 'Blue', color: '#2563eb', tone: 'vivid', hue: 263, primary: [0.487, 0.25, 0.72, 0.2] },
  indigo: { label: 'Indigo', color: '#4338ca', tone: 'vivid', hue: 276, primary: [0.51, 0.26, 0.72, 0.22] },
  violet: { label: 'Violet', color: '#7c3aed', tone: 'vivid', hue: 292, primary: [0.491, 0.27, 0.72, 0.23] },
  fuchsia: { label: 'Fuchsia', color: '#c026d3', tone: 'vivid', hue: 312, primary: [0.56, 0.27, 0.75, 0.22] },
  pink: { label: 'Pink', color: '#db2777', tone: 'vivid', hue: 328, primary: [0.56, 0.26, 0.75, 0.22] },
  coral: { label: 'Coral', color: '#e8968a', tone: 'pastel', hue: 25, primary: [0.6, 0.12, 0.76, 0.1] },
  peach: { label: 'Peach', color: '#e8b08a', tone: 'pastel', hue: 38, primary: [0.63, 0.11, 0.78, 0.09] },
  butter: { label: 'Butter', color: '#d4be7a', tone: 'pastel', hue: 80, primary: [0.66, 0.13, 0.8, 0.11] },
  lemon: { label: 'Lemon', color: '#d4d07a', tone: 'pastel', hue: 100, primary: [0.7, 0.12, 0.82, 0.1] },
  celadon: { label: 'Celadon', color: '#a0c8a0', tone: 'pastel', hue: 122, primary: [0.61, 0.1, 0.76, 0.08] },
  sage: { label: 'Sage', color: '#92ad91', tone: 'pastel', hue: 142, primary: [0.52, 0.1, 0.72, 0.09] },
  mint: { label: 'Mint', color: '#96c8b8', tone: 'pastel', hue: 158, primary: [0.6, 0.1, 0.75, 0.09] },
  seafoam: { label: 'Seafoam', color: '#96c4bc', tone: 'pastel', hue: 178, primary: [0.61, 0.09, 0.76, 0.08] },
  powder: { label: 'Powder', color: '#90b8d0', tone: 'pastel', hue: 205, primary: [0.59, 0.1, 0.75, 0.09] },
  mist: { label: 'Mist', color: '#8aacc8', tone: 'pastel', hue: 218, primary: [0.56, 0.1, 0.74, 0.09] },
  periwinkle: { label: 'Periwinkle', color: '#9fa8d8', tone: 'pastel', hue: 265, primary: [0.54, 0.11, 0.73, 0.1] },
  wisteria: { label: 'Wisteria', color: '#b0a0d0', tone: 'pastel', hue: 285, primary: [0.55, 0.1, 0.73, 0.09] },
  lavender: { label: 'Lavender', color: '#b8a8d4', tone: 'pastel', hue: 300, primary: [0.55, 0.11, 0.73, 0.1] },
  orchid: { label: 'Orchid', color: '#c8a8c8', tone: 'pastel', hue: 315, primary: [0.56, 0.11, 0.74, 0.1] },
  blush: { label: 'Blush', color: '#c8a0b4', tone: 'pastel', hue: 345, primary: [0.54, 0.11, 0.73, 0.1] },
}

export const DEFAULT_ACCENT: Accent = 'blue'

export function resolveAccent(accent: string | null | undefined): Accent {
  if (!accent) return DEFAULT_ACCENT
  return (ACCENT_IDS as readonly string[]).includes(accent) ? (accent as Accent) : DEFAULT_ACCENT
}

export function isPastelAccent(accent: string | null | undefined): boolean {
  const id = resolveAccent(accent)
  return ACCENT_META_BY_ID[id].tone === 'pastel'
}

const ALL_ACCENT_OPTIONS: readonly AccentOption[] = ACCENT_IDS.map((id) => ({
  id,
  label: ACCENT_META_BY_ID[id].label,
  color: ACCENT_META_BY_ID[id].color,
}))

const byHue = (a: AccentOption, b: AccentOption) => ACCENT_META_BY_ID[a.id].hue - ACCENT_META_BY_ID[b.id].hue

export const ACCENT_VIVID: readonly AccentOption[] = [...ALL_ACCENT_OPTIONS].filter((opt) => ACCENT_META_BY_ID[opt.id].tone === 'vivid').sort(byHue)

export const ACCENT_PASTEL: readonly AccentOption[] = [...ALL_ACCENT_OPTIONS].filter((opt) => ACCENT_META_BY_ID[opt.id].tone === 'pastel').sort(byHue)

export const ACCENT_OPTIONS: readonly AccentOption[] = [...ACCENT_VIVID, ...ACCENT_PASTEL]

export const ACCENT_HUE: Record<Accent, number> = Object.fromEntries(ACCENT_IDS.map((id) => [id, ACCENT_META_BY_ID[id].hue])) as Record<
  Accent,
  number
>

export const ACCENT_PRIMARY: Record<Accent, AccentPrimaryDef> = Object.fromEntries(
  ACCENT_IDS.map((id) => [id, ACCENT_META_BY_ID[id].primary]),
) as Record<Accent, AccentPrimaryDef>
