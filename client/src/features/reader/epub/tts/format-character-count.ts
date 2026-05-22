export function formatTtsCharacterCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0'

  if (count >= 1_000_000) {
    const millions = count / 1_000_000
    return Number.isInteger(millions) ? `${millions}M` : `${trimTrailingZero(millions.toFixed(1))}M`
  }

  if (count >= 1_000) {
    const thousands = count / 1_000
    if (thousands >= 100) return `${Math.round(thousands)}k`
    return Number.isInteger(thousands) ? `${thousands}K` : `${trimTrailingZero(thousands.toFixed(1))}K`
  }

  return String(Math.round(count))
}

function trimTrailingZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value
}
