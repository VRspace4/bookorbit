export interface HslColor {
  h: number
  s: number
  l: number
}

export function normalizeHex(value: string): string | null {
  const trimmed = value.trim()
  const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/)
  if (!match) return null
  return `#${match[1].toLowerCase()}`
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(hex)
  if (!normalized) return null
  const value = Number.parseInt(normalized.slice(1), 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (channel: number) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function rgbToHsl(r: number, g: number, b: number): HslColor {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  let hue = 0
  let saturation = 0

  if (max !== min) {
    const delta = max - min
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    switch (max) {
      case red:
        hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6
        break
      case green:
        hue = ((blue - red) / delta + 2) / 6
        break
      default:
        hue = ((red - green) / delta + 4) / 6
        break
    }
  }

  return { h: hue * 360, s: saturation * 100, l: lightness * 100 }
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360
  const saturation = clamp(s, 0, 100) / 100
  const lightness = clamp(l, 0, 100) / 100

  if (saturation === 0) {
    const channel = lightness * 255
    return { r: channel, g: channel, b: channel }
  }

  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const hueToChannel = (offset: number) => {
    let t = offset
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  const hueUnit = hue / 360
  return {
    r: hueToChannel(hueUnit + 1 / 3) * 255,
    g: hueToChannel(hueUnit) * 255,
    b: hueToChannel(hueUnit - 1 / 3) * 255,
  }
}

export function hexToHsl(hex: string): HslColor | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  return rgbToHsl(rgb.r, rgb.g, rgb.b)
}

export function hslToHex(h: number, s: number, l: number): string {
  const rgb = hslToRgb(h, s, l)
  return rgbToHex(rgb.r, rgb.g, rgb.b)
}
