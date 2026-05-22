import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Readable } from 'stream';
import { ZlibLimitReachedException } from './zlib-limit.exception';

const ZLIB_BASE = 'https://z-library.im/eapi';

export interface ZlibLoginResult {
  email: string;
  remixUserId: string;
  remixUserKey: string;
  sessionCookies: string;
}

export interface ZlibBook {
  id: string;
  hash: string;
  title: string;
  author: string;
  year: string;
  language: string;
  extension: string;
  filesize: number;
  cover: string;
}

export interface ZlibSearchResult {
  books: ZlibBook[];
  total: number;
}

function encodeBody(params: Record<string, string | number | string[]>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) parts.push(`${encodeURIComponent(key + '[]')}=${encodeURIComponent(v)}`);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join('&');
}

@Injectable()
export class ZlibApiService {
  private readonly logger = new Logger(ZlibApiService.name);

  async login(email: string, password: string): Promise<ZlibLoginResult> {
    const res = await fetch(`${ZLIB_BASE}/user/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0',
      },
      body: encodeBody({ email, password }),
    });

    if (!res.ok) {
      throw new UnauthorizedException(`Z-Library login failed: ${res.status}`);
    }

    const json = (await res.json()) as { user?: { id: number | string; remix_userkey: string; email: string } };
    if (!json.user) {
      throw new UnauthorizedException('Invalid Z-Library credentials');
    }

    const setCookieHeaders = res.headers.getSetCookie?.() ?? [];
    const sessionCookies = setCookieHeaders.map((c) => c.split(';')[0]).join('; ');

    return {
      email: json.user.email ?? email,
      remixUserId: String(json.user.id),
      remixUserKey: json.user.remix_userkey,
      sessionCookies,
    };
  }

  async search(remixUserId: string, remixUserKey: string, q: string, format?: string, limit = 20): Promise<ZlibSearchResult> {
    const body: Record<string, string | number | string[]> = {
      message: q,
      page: 1,
      limit,
    };
    if (format) body['extensions[]'] = [format];

    const res = await fetch(`${ZLIB_BASE}/book/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0',
        'remix-userid': remixUserId,
        'remix-userkey': remixUserKey,
      },
      body: encodeBody(body),
    });

    if (!res.ok) {
      throw new Error(`Z-Library search failed: ${res.status}`);
    }

    const json = (await res.json()) as { books?: ZlibBook[]; total?: number };
    return {
      books: json.books ?? [],
      total: json.total ?? 0,
    };
  }

  async downloadStream(
    remixUserId: string,
    remixUserKey: string,
    sessionCookies: string,
    bookId: string,
    hash: string,
  ): Promise<{ stream: Readable; filename: string }> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0',
      'remix-userid': remixUserId,
      'remix-userkey': remixUserKey,
    };
    if (sessionCookies) headers['Cookie'] = sessionCookies;

    const dlRes = await fetch(`${ZLIB_BASE}/book/${bookId}/${hash}/file/download`, { headers });
    if (!dlRes.ok) {
      const body = await dlRes.text().catch(() => '');
      this.logger.error(`Z-Library download API failed: ${dlRes.status} — ${body}`);
      throw new Error(`Z-Library download request failed: ${dlRes.status}`);
    }

    const json = (await dlRes.json()) as {
      file?: { downloadLink?: string; description?: string };
      error?: string;
      errorType?: string;
      code?: number;
    };
    this.logger.debug(`Z-Library download response: ${JSON.stringify(json)}`);

    // Detect daily download limit errors
    const isLimitError =
      json.errorType === 'DailyDownloadLimitReached' ||
      (typeof json.error === 'string' && /limit|quota|exceeded/i.test(json.error)) ||
      json.code === 429;
    if (isLimitError) {
      throw new ZlibLimitReachedException();
    }

    const downloadUrl = json.file?.downloadLink;
    if (!downloadUrl) {
      throw new Error('No download link returned by Z-Library');
    }

    const description = json.file?.description ?? 'book';
    const fileRes = await fetch(downloadUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!fileRes.ok) {
      throw new Error(`Z-Library file fetch failed: ${fileRes.status}`);
    }

    if (!fileRes.body) {
      throw new Error('No response body from Z-Library CDN');
    }

    // Derive filename from description and URL extension
    const extMatch = new URL(downloadUrl).pathname.match(/\.([a-z0-9]{2,6})$/i);
    const extension = extMatch ? extMatch[1].toLowerCase() : 'epub';
    const safeName = description.replace(/[^\w\s.-]/g, '').trim() || 'book';
    const filename = `${safeName}.${extension}`;

    const readable = Readable.fromWeb(fileRes.body as import('stream/web').ReadableStream);
    return { stream: readable, filename };
  }
}
