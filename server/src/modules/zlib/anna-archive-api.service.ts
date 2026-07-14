import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'stream';

import {
  AnnaArchiveChallengeError,
  isChallengePage,
  isLikelyDirectMirror,
  normalizeUrl,
  parseAnnaBookDetails,
  parseAnnaSearchResults,
  parseSlowDownloadMirrors,
  type AnnaArchiveBook,
  type AnnaArchiveBookDetails,
} from './anna-archive.parser';

export interface AnnaArchiveSearchResult {
  books: AnnaArchiveBook[];
  total: number;
}

const DEFAULT_BASE_URLS = ['https://annas-archive.gl', 'https://annas-archive.pk', 'https://annas-archive.gd'];
const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_START_TIMEOUT_MS = 30_000;
const HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};

@Injectable()
export class AnnaArchiveApiService {
  private readonly logger = new Logger(AnnaArchiveApiService.name);

  constructor(private readonly config: ConfigService) {}

  async search(q: string, format?: string, limit = 20): Promise<AnnaArchiveSearchResult> {
    const searchLimit = normalizeLimit(limit);
    const errors: string[] = [];
    let challengeUrl = '';
    let sawChallenge = false;

    for (const baseUrl of this.baseUrls()) {
      const url = new URL('/search', baseUrl);
      url.searchParams.set('index', '');
      url.searchParams.set('page', '1');
      url.searchParams.set('sort', '');
      url.searchParams.set('display', '');
      url.searchParams.set('q', q);
      const searchUrl = url.toString();

      try {
        const { html } = await this.fetchHtml(searchUrl, 'search');
        const books = parseAnnaSearchResults(html, baseUrl, format).slice(0, searchLimit);
        return { books, total: books.length };
      } catch (err) {
        if (err instanceof AnnaArchiveChallengeError) {
          sawChallenge = true;
          challengeUrl ||= searchUrl;
        }
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${baseUrl}: ${message}`);
        this.logger.warn(`[anna_archive] search failed baseUrl=${baseUrl} message="${sanitizeLog(message)}"`);
      }
    }

    if (sawChallenge) {
      throw new ServiceUnavailableException({
        code: 'ANNA_ARCHIVE_CHALLENGE',
        message: "Anna's Archive requires browser verification before search results are available.",
        challengeUrl,
      });
    }

    throw new BadGatewayException(`Anna’s Archive search failed: ${errors.join('; ')}`);
  }

  async downloadStream(md5: string, requestedFormat?: string): Promise<{ stream: Readable; filename: string }> {
    const { details, mirrors } = await this.resolveDownloadMirrors(md5);
    return this.downloadFromMirrors(mirrors, details.title, requestedFormat);
  }

  async downloadMirrorStream(mirrors: string[], filename: string, requestedFormat?: string): Promise<{ stream: Readable; filename: string }> {
    const validMirrors = await filterSafeMirrorUrls(mirrors);
    if (validMirrors.length === 0) {
      throw new BadGatewayException('No valid Anna’s Archive download mirrors were provided by the browser resolver');
    }

    return this.downloadFromMirrors(validMirrors, filename, requestedFormat);
  }

  private async downloadFromMirrors(
    mirrors: string[],
    filenameOrTitle: string,
    requestedFormat?: string,
  ): Promise<{ stream: Readable; filename: string }> {
    const orderedMirrors = reorderMirrors(mirrors);
    const errors: string[] = [];

    for (const mirror of orderedMirrors) {
      try {
        const res = await fetch(mirror, {
          headers: { 'User-Agent': HEADERS['User-Agent'], Accept: '*/*' },
          redirect: 'follow',
          signal: buildRequestSignal(DOWNLOAD_START_TIMEOUT_MS),
        });

        if (!res.ok || !res.body) {
          errors.push(`${mirror}: ${res.status}`);
          continue;
        }
        const contentType = res.headers.get('content-type') ?? '';
        if (/text\/html/i.test(contentType)) {
          await res.body.cancel().catch(() => undefined);
          errors.push(`${mirror}: returned HTML instead of a book file`);
          continue;
        }

        const extension = extensionFromUrl(mirror) || requestedFormat || 'epub';
        return {
          stream: Readable.fromWeb(res.body as import('stream/web').ReadableStream),
          filename: buildFilename(filenameOrTitle, extension),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${mirror}: ${message}`);
      }
    }

    throw new BadGatewayException(`No working Anna’s Archive download mirror found${errors.length ? `: ${errors.join('; ')}` : ''}`);
  }

  private async resolveDownloadMirrors(md5: string): Promise<{ details: AnnaArchiveBookDetails; mirrors: string[] }> {
    const errors: string[] = [];
    let sawChallenge = false;
    let challengeUrl = '';

    for (const baseUrl of this.baseUrls()) {
      const detailUrl = new URL(`/md5/${md5}`, baseUrl).toString();
      try {
        const detailResponse = await this.fetchHtml(detailUrl, 'detail');
        const details = parseAnnaBookDetails(detailResponse.html, detailUrl, baseUrl);
        const mirrors = [...details.mirrorUrls];

        for (const slowUrl of details.slowDownloadUrls) {
          try {
            const slowResponse = await this.fetchHtml(slowUrl, 'slow_download', detailResponse.cookieHeader);
            mirrors.push(...parseSlowDownloadMirrors(slowResponse.html, slowUrl, baseUrl));
          } catch (err) {
            if (err instanceof AnnaArchiveChallengeError) {
              sawChallenge = true;
              challengeUrl ||= slowUrl;
              break;
            }
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`[anna_archive] slow mirror resolution failed url=${slowUrl} message="${sanitizeLog(message)}"`);
          }
        }

        const uniqueMirrors = [...new Set(mirrors)];
        if (uniqueMirrors.length > 0) {
          return { details, mirrors: uniqueMirrors };
        }

        if (sawChallenge) {
          throw new AnnaArchiveChallengeError('Anna’s Archive requires a browser challenge before exposing download mirrors');
        }

        errors.push(`${baseUrl}: no mirrors found`);
      } catch (err) {
        if (err instanceof AnnaArchiveChallengeError) {
          sawChallenge = true;
        }
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${baseUrl}: ${message}`);
        this.logger.warn(`[anna_archive] detail failed baseUrl=${baseUrl} message="${sanitizeLog(message)}"`);
      }
    }

    if (sawChallenge) {
      throw new ServiceUnavailableException({
        code: 'ANNA_ARCHIVE_CHALLENGE',
        message: 'Anna’s Archive is requiring a browser challenge before download mirrors are available. Try again later or use Z-Library.',
        challengeUrl,
      });
    }

    throw new BadGatewayException(`Anna’s Archive download mirrors could not be resolved: ${errors.join('; ')}`);
  }

  private async fetchHtml(url: string, op: string, cookieHeader = ''): Promise<{ html: string; cookieHeader: string }> {
    const startedAt = Date.now();
    const headers: Record<string, string> = { ...HEADERS };
    if (cookieHeader) headers.Cookie = cookieHeader;

    const res = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: buildRequestSignal(REQUEST_TIMEOUT_MS),
    });

    const html = await res.text();
    if (isChallengePage(html)) {
      throw new AnnaArchiveChallengeError(`Anna’s Archive ${op} returned an anti-bot challenge`);
    }

    if (!res.ok) {
      throw new Error(`Anna’s Archive ${op} failed: ${res.status}`);
    }

    this.logger.debug(`[anna_archive] ${op} url=${url} durationMs=${Date.now() - startedAt}`);
    return {
      html,
      cookieHeader: mergeCookieHeaders(cookieHeader, res.headers.getSetCookie?.() ?? []),
    };
  }

  private baseUrls(): string[] {
    const configured = this.config.get<string[] | string>('zlib.annaArchiveBaseUrls');
    const values = Array.isArray(configured) ? configured : typeof configured === 'string' ? configured.split(',') : DEFAULT_BASE_URLS;
    const normalized = values.map((value) => value.trim().replace(/\/+$/, '')).filter((value) => /^https?:\/\//i.test(value));
    return normalized.length > 0 ? normalized : DEFAULT_BASE_URLS;
  }
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 20;
  return Math.min(Math.max(Math.floor(limit), 1), 50);
}

function buildRequestSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

function mergeCookieHeaders(existing: string, setCookieHeaders: string[]): string {
  const cookies = new Map<string, string>();
  for (const part of existing.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name] = trimmed.split('=');
    if (name) cookies.set(name, trimmed);
  }
  for (const header of setCookieHeaders) {
    const cookie = header.split(';')[0]?.trim();
    const [name] = cookie?.split('=') ?? [];
    if (name && cookie) cookies.set(name, cookie);
  }
  return [...cookies.values()].join('; ');
}

function reorderMirrors(mirrors: string[]): string[] {
  const ipfs: string[] = [];
  const https: string[] = [];
  const rest: string[] = [];

  for (const mirror of mirrors) {
    if (/ipfs/i.test(mirror)) {
      ipfs.push(mirror);
    } else if (/^https:\/\//i.test(mirror) && !/^https:\/\/1lib\.sk/i.test(mirror)) {
      https.push(mirror);
    } else {
      rest.push(mirror);
    }
  }

  return [...ipfs, ...https, ...rest];
}

function extensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.match(/\.([a-z0-9]{2,6})$/i)?.[1]?.toLowerCase() ?? '';
  } catch {
    return '';
  }
}

function buildFilename(title: string, extension: string): string {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'epub';
  const safeTitle = title.replace(/[^\w\s.-]/g, '').trim() || 'book';
  const withoutExtension = safeTitle.replace(new RegExp(`\\.${escapeRegExp(safeExtension)}$`, 'i'), '').trim() || 'book';
  return `${withoutExtension}.${safeExtension}`;
}

function sanitizeLog(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
}

async function filterSafeMirrorUrls(values: string[]): Promise<string[]> {
  const safe: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const url = normalizeUrl(value, 'https://annas-archive.gl');
    if (!url || seen.has(url) || !isLikelyDirectMirror(url)) continue;
    if (!(await hasPublicNetworkAddress(url))) continue;
    seen.add(url);
    safe.push(url);
  }

  return safe;
}

async function hasPublicNetworkAddress(rawUrl: string): Promise<boolean> {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return false;

    const literalFamily = isIP(host);
    if (literalFamily !== 0) return !isPrivateAddress(host);

    const records = await lookup(host, { all: true, verbatim: true });
    return records.length > 0 && records.every((record) => !isPrivateAddress(record.address));
  } catch {
    return false;
  }
}

function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')
    );
  }

  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
