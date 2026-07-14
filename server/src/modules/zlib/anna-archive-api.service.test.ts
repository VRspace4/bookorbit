import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';

import { AnnaArchiveApiService } from './anna-archive-api.service';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

describe('AnnaArchiveApiService', () => {
  const fetchMock = vi.fn();
  const lookupMock = vi.mocked(lookup);

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a dedicated search challenge payload when Anna blocks search pages', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('<title>DDoS-Guard</title>'),
      headers: {
        getSetCookie: vi.fn().mockReturnValue([]),
      },
    });

    const config = {
      get: vi.fn().mockReturnValue(['https://annas-archive.gl']),
    } as unknown as ConfigService;
    const service = new AnnaArchiveApiService(config);

    let thrown: unknown;
    try {
      await service.search('public domain', 'pdf', 20);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    const response = (thrown as ServiceUnavailableException).getResponse();
    expect(response).toMatchObject({
      code: 'ANNA_ARCHIVE_CHALLENGE',
      message: "Anna's Archive requires browser verification before search results are available.",
      challengeUrl: 'https://annas-archive.gl/search?index=&page=1&sort=&display=&q=public+domain',
    });
    expect(fetchMock).toHaveBeenCalledWith('https://annas-archive.gl/search?index=&page=1&sort=&display=&q=public+domain', expect.any(Object));
  });

  it('reports slow-download browser verification when slow pages return non-OK challenge HTML', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(`
          <main class="main"><div class="main-inner">
            <div class="font-semibold text-2xl">The Art of Spending Money</div>
            <a href="/search?q=Morgan Housel" class="text-base">Morgan Housel</a>
            <div class="text-gray-800">English [en] · EPUB · 0.7MB · 2025 · Book</div>
            <ul class="list-inside">
              <li><a href="/slow_download/bb7104fef335c5a3a30d7842e09841eb/0/0" class="js-download-link">Slow Partner Server #1</a></li>
            </ul>
            <ul class="list-inside mb-4 ml-1 js-show-external hidden">
              <li><a href="https://z-lib.gd/md5/bb7104fef335c5a3a30d7842e09841eb" class="js-download-link">Z-Library</a></li>
              <li><a href="http://bookszlibb74ugqojhzhg2a63w5i2atv5bqarulgczawnbmsb6s6qead.onion/md5/bb7104fef335c5a3a30d7842e09841eb" class="js-download-link">Z-Library on Tor</a></li>
            </ul>
          </div></main>
        `),
        headers: {
          getSetCookie: vi.fn().mockReturnValue(['__ddg1_=abc; Path=/']),
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: vi.fn().mockResolvedValue('<title>DDoS-Guard</title>'),
        headers: {
          getSetCookie: vi.fn().mockReturnValue([]),
        },
      });

    const config = {
      get: vi.fn().mockReturnValue(['https://annas-archive.gl']),
    } as unknown as ConfigService;
    const service = new AnnaArchiveApiService(config);

    await expect(service.downloadStream('bb7104fef335c5a3a30d7842e09841eb', 'epub')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('z-lib.gd'), expect.any(Object));
  });

  it('downloads from browser-resolved direct mirrors after validating public hosts', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('book'));
          controller.close();
        },
      }),
      headers: {
        get: vi.fn().mockReturnValue('application/epub+zip'),
      },
    });

    const config = {
      get: vi.fn().mockReturnValue(['https://annas-archive.gl']),
    } as unknown as ConfigService;
    const service = new AnnaArchiveApiService(config);

    const result = await service.downloadMirrorStream(
      ['https://download.example/files/book.epub', 'https://z-lib.gd/md5/bb7104fef335c5a3a30d7842e09841eb'],
      'The Art of Spending Money.epub',
      'epub',
    );

    expect(result.filename).toBe('The Art of Spending Money.epub');
    expect(lookupMock).toHaveBeenCalledWith('download.example', { all: true, verbatim: true });
    expect(fetchMock).toHaveBeenCalledWith('https://download.example/files/book.epub', expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('z-lib.gd'), expect.any(Object));
  });
});
