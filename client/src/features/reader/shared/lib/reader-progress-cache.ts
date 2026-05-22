export interface CachedReaderProgress {
  cfi: string | null
  pageNumber: number | null
  positionSeconds: number | null
  percentage: number
  ttsSectionIndex: number | null
  ttsWordIndex: number | null
  updatedAt: string
}

const KEY_PREFIX = 'reader:progress:'

function storageKey(fileId: number) {
  return `${KEY_PREFIX}${fileId}`
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isNonNegativeIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0)
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function sanitizeProgress(value: unknown): CachedReaderProgress | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Partial<CachedReaderProgress>
  if (typeof raw.percentage !== 'number' || !Number.isFinite(raw.percentage)) return null
  if (typeof raw.updatedAt !== 'string' || Number.isNaN(Date.parse(raw.updatedAt))) return null
  if (!(typeof raw.cfi === 'string' || raw.cfi === null || raw.cfi === undefined)) return null
  if (!isNumberOrNull(raw.pageNumber ?? null) || !isNumberOrNull(raw.positionSeconds ?? null)) return null
  const ttsSectionIndex = raw.ttsSectionIndex ?? null
  const ttsWordIndex = raw.ttsWordIndex ?? null
  if (!isNonNegativeIntegerOrNull(ttsSectionIndex) || !isNonNegativeIntegerOrNull(ttsWordIndex)) return null

  return {
    cfi: raw.cfi ?? null,
    pageNumber: raw.pageNumber ?? null,
    positionSeconds: raw.positionSeconds ?? null,
    percentage: clampPercentage(raw.percentage),
    ttsSectionIndex,
    ttsWordIndex,
    updatedAt: raw.updatedAt,
  }
}

export function readCachedReaderProgress(fileId: number): CachedReaderProgress | null {
  try {
    const raw = window.localStorage.getItem(storageKey(fileId))
    if (!raw) return null
    const sanitized = sanitizeProgress(JSON.parse(raw))
    if (!sanitized) {
      window.localStorage.removeItem(storageKey(fileId))
      return null
    }
    return sanitized
  } catch {
    return null
  }
}

export function writeCachedReaderProgress(fileId: number, progress: Omit<CachedReaderProgress, 'updatedAt'> & { updatedAt?: string | null }): void {
  try {
    const next: CachedReaderProgress = {
      cfi: progress.cfi ?? null,
      pageNumber: progress.pageNumber ?? null,
      positionSeconds: progress.positionSeconds ?? null,
      percentage: clampPercentage(progress.percentage),
      ttsSectionIndex: progress.ttsSectionIndex ?? null,
      ttsWordIndex: progress.ttsWordIndex ?? null,
      updatedAt: progress.updatedAt ?? new Date().toISOString(),
    }
    window.localStorage.setItem(storageKey(fileId), JSON.stringify(next))
  } catch {
    // Ignore local persistence failures; server progress remains authoritative.
  }
}

export function clearCachedReaderProgress(fileId: number): void {
  try {
    window.localStorage.removeItem(storageKey(fileId))
  } catch {
    // Ignore local persistence failures.
  }
}

export function clearAllCachedReaderProgress(): void {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(KEY_PREFIX)) window.localStorage.removeItem(key)
    }
  } catch {
    // Ignore local persistence failures.
  }
}
