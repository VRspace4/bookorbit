import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

type CheerioSelection = ReturnType<CheerioAPI>;

export interface AnnaArchiveBook {
  id: string;
  hash: string;
  title: string;
  author: string;
  year: string;
  language: string;
  extension: string;
  filesize: number;
  cover: string;
  source: 'anna';
  detailUrl: string;
  info: string;
}

export interface AnnaArchiveBookDetails extends AnnaArchiveBook {
  description: string;
  slowDownloadUrls: string[];
  mirrorUrls: string[];
}

const SUPPORTED_EXTENSIONS = new Set(['epub', 'pdf', 'mobi', 'fb2', 'djvu', 'cbz', 'cbr', 'azw3', 'azw']);

export function parseAnnaSearchResults(html: string, baseUrl: string, requestedFormat = ''): AnnaArchiveBook[] {
  const $ = cheerio.load(html);
  const books: AnnaArchiveBook[] = [];
  const seen = new Set<string>();

  $('a.js-vim-focus[href^="/md5/"], a.js-vim-focus[href*="/md5/"]').each((_, link) => {
    const linkEl = $(link);
    const href = linkEl.attr('href');
    const md5 = extractMd5(href);
    if (!href || !md5 || seen.has(md5)) return;

    const container = findResultContainer($, linkEl);
    const info = normalizeWhitespace(container.find('.text-gray-800').first().text());
    const extension = parseExtension(info);
    if (!matchesRequestedFormat(extension, requestedFormat)) return;

    const author = normalizeWhitespace(linkEl.nextAll('a[href^="/search?q="]').first().text()) || 'unknown';
    const cover = normalizeUrl(container.find('a[href^="/md5/"] img, a[href*="/md5/"] img').first().attr('src') ?? '', baseUrl);

    seen.add(md5);
    books.push({
      id: md5,
      hash: md5,
      title: normalizeWhitespace(linkEl.text()) || 'Untitled',
      author,
      year: parseYear(info),
      language: parseLanguage(info),
      extension,
      filesize: parseFileSizeBytes(info),
      cover,
      source: 'anna',
      detailUrl: normalizeUrl(href, baseUrl),
      info,
    });
  });

  return books;
}

export function parseAnnaBookDetails(html: string, detailUrl: string, baseUrl: string): AnnaArchiveBookDetails {
  if (isChallengePage(html)) {
    throw new AnnaArchiveChallengeError('Anna’s Archive returned an anti-bot challenge');
  }

  const $ = cheerio.load(html);
  const main = $('div.main-inner').first();
  if (!main.length) {
    throw new Error('Anna’s Archive detail page could not be parsed');
  }

  const md5 = extractMd5(detailUrl);
  if (!md5) {
    throw new Error('Anna’s Archive detail URL is missing an md5 identifier');
  }

  const info = normalizeWhitespace(main.find('.text-gray-800').first().text());
  const titleText = main.find('div.font-semibold.text-2xl').first().contents().first().text();
  const title = normalizeWhitespace(titleText || main.find('div.font-semibold.text-2xl').first().text()) || 'book';
  const author = normalizeWhitespace(main.find('a[href^="/search?q="].text-base').first().text()) || 'unknown';
  const cover = normalizeUrl(main.find('div[id^="list_cover_"] img').first().attr('src') ?? '', baseUrl);

  const description = extractDescription($);
  const slowDownloadUrls = unique(
    main
      .find('a[href*="/slow_download/"]')
      .toArray()
      .map((a) => normalizeUrl($(a).attr('href') ?? '', baseUrl))
      .filter(Boolean),
  );

  const mirrorUrls = unique(
    main
      .find('.js-show-external a[href], a.js-download-link[href]')
      .toArray()
      .map((a) => normalizeUrl($(a).attr('href') ?? '', baseUrl))
      .filter(isLikelyDirectMirror),
  );

  return {
    id: md5,
    hash: md5,
    title,
    author,
    year: parseYear(info),
    language: parseLanguage(info),
    extension: parseExtension(info),
    filesize: parseFileSizeBytes(info),
    cover,
    source: 'anna',
    detailUrl: normalizeUrl(detailUrl, baseUrl),
    info,
    description,
    slowDownloadUrls,
    mirrorUrls,
  };
}

export function parseSlowDownloadMirrors(html: string, pageUrl: string, baseUrl: string): string[] {
  if (isChallengePage(html)) {
    throw new AnnaArchiveChallengeError('Anna’s Archive returned an anti-bot challenge while resolving download mirrors');
  }

  const $ = cheerio.load(html);
  const urls: string[] = [];

  if (pageUrl.includes('/slow_download/')) {
    const primary = $('p.mb-4.text-xl.font-bold a[href]').first().attr('href');
    if (primary) urls.push(normalizeUrl(primary, baseUrl));
  }

  $('ul > li > a[href]').each((_, a) => {
    const href = normalizeUrl($(a).attr('href') ?? '', baseUrl);
    if (isLikelyDirectMirror(href)) urls.push(href);
  });

  return unique(urls.filter(isLikelyDirectMirror));
}

export function extractMd5(url: string | undefined): string {
  if (!url) return '';
  const match = url.match(/\/md5\/([a-f0-9]{32})/i) ?? url.match(/\/slow_download\/([a-f0-9]{32})/i);
  return match?.[1]?.toLowerCase() ?? '';
}

export function normalizeUrl(value: string, baseUrl: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return '';
  }
}

export function isChallengePage(html: string): boolean {
  const title = html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() ?? '';
  return /^DDoS-Guard$/i.test(title) || /Checking your browser before accessing/i.test(html);
}

export class AnnaArchiveChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnaArchiveChallengeError';
  }
}

function findResultContainer($: CheerioAPI, linkEl: CheerioSelection): CheerioSelection {
  const container = linkEl.closest('div.flex.pt-3.pb-3.border-b');
  if (container.length) return container;
  const md5Container = linkEl.closest('div').parent().parent();
  return md5Container.length ? md5Container : linkEl.parent();
}

function matchesRequestedFormat(extension: string, requestedFormat: string): boolean {
  return !requestedFormat || extension === requestedFormat.toLowerCase();
}

function parseExtension(info: string): string {
  const parts = info.split('·').map((part) => normalizeWhitespace(part).toLowerCase());
  for (const part of parts) {
    const clean = part.replace(/[^a-z0-9]/g, '');
    if (SUPPORTED_EXTENSIONS.has(clean)) return clean;
  }
  const match = info.match(/\b(epub|pdf|mobi|fb2|djvu|cbz|cbr|azw3|azw)\b/i);
  return match ? match[1].toLowerCase() : 'epub';
}

function parseYear(info: string): string {
  return info.match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1] ?? '';
}

function parseLanguage(info: string): string {
  const first = normalizeWhitespace(info.split('·')[0] ?? '');
  const bracket = first.match(/^(.+?)\s*\[[^\]]+\]/);
  const raw = bracket?.[1] ?? first;
  return raw
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim()
    .toLowerCase();
}

function parseFileSizeBytes(info: string): number {
  const match = info.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|B)\b/i);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = match[2].toUpperCase();
  const multiplier = unit === 'TB' ? 1024 ** 4 : unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : unit === 'KB' ? 1024 : 1;
  return Math.round(value * multiplier);
}

function extractDescription($: CheerioAPI): string {
  const container = $('.js-md5-top-box-description').first();
  if (!container.length) return '';

  const labels = container.find('div.text-xs.text-gray-500.uppercase').toArray();
  for (const label of labels) {
    if (normalizeWhitespace($(label).text()).toLowerCase() !== 'description') continue;
    return normalizeWhitespace($(label).next().text());
  }
  return '';
}

export function isLikelyDirectMirror(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.onion(?:\/|$)/i.test(url)) return false;
  if (/annas-archive\./i.test(url)) return false;
  if (/z-lib\./i.test(url)) return false;
  if (/\/md5\/[a-f0-9]{32}(?:[/?#]|$)/i.test(url)) return false;
  if (/\/torrents(?:#|\/|$)|\.torrent(?:\?|$)/i.test(url)) return false;
  if (/motrix|readera|calibre|cloudconvert|printfriendly|sendtokindle|send\.djazz/i.test(url)) return false;
  return true;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
