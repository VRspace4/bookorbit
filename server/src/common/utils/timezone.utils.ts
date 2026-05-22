import { fromZonedTime } from 'date-fns-tz';

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function getDatePart(parts: Intl.DateTimeFormatPart[], type: 'year' | 'month' | 'day'): string {
  const part = parts.find((entry) => entry.type === type);
  if (!part) throw new RangeError(`Missing '${type}' in formatted date parts`);
  return part.value;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(value: unknown, fallback = 'UTC'): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (!normalized) return fallback;
  return isValidTimeZone(normalized) ? normalized : fallback;
}

export function isDateKey(value: string): boolean {
  const match = DATE_KEY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

export function toDateKeyInTimeZone(date: Date, timeZone: string): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid date');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = getDatePart(parts, 'year');
  const month = getDatePart(parts, 'month');
  const day = getDatePart(parts, 'day');
  return `${year}-${month}-${day}`;
}

export function toTimeZoneStartOfDay(dateKey: string, timeZone: string): Date {
  if (!isDateKey(dateKey)) {
    throw new RangeError(`Invalid date key: ${dateKey}`);
  }
  const parsed = fromZonedTime(`${dateKey}T00:00:00`, timeZone);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Invalid timezone conversion for date key: ${dateKey}`);
  }
  return parsed;
}
