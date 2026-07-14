import {
  AnnaArchiveChallengeError,
  isChallengePage,
  parseAnnaBookDetails,
  parseAnnaSearchResults,
  parseSlowDownloadMirrors,
} from './anna-archive.parser';

const BASE_URL = 'https://annas-archive.gl';

describe('Anna Archive parser', () => {
  it('parses current Anna search result cards into BookOrbit search results', () => {
    const html = `
      <div class="flex pt-3 pb-3 border-b">
        <a href="/md5/426e8513e507b07dc42c54fd0f1b4048" class="custom-a block"><img src="/covers/book.jpg"></a>
        <div>
          <a href="/md5/426e8513e507b07dc42c54fd0f1b4048" class="line-clamp-[3] js-vim-focus">The public domain</a>
          <a href="/search?q=Stephen Fishman" class="block"> Stephen Fishman</a>
          <a href="/search?q=NOLO" class="block">NOLO, 2023</a>
          <div class="text-gray-800">English [en] · PDF · 5.2MB · 2023 · Book (non-fiction)</div>
        </div>
      </div>
    `;

    const results = parseAnnaSearchResults(html, BASE_URL, 'pdf');

    expect(results).toEqual([
      expect.objectContaining({
        id: '426e8513e507b07dc42c54fd0f1b4048',
        hash: '426e8513e507b07dc42c54fd0f1b4048',
        title: 'The public domain',
        author: 'Stephen Fishman',
        year: '2023',
        language: 'english',
        extension: 'pdf',
        filesize: 5_452_595,
        cover: 'https://annas-archive.gl/covers/book.jpg',
        source: 'anna',
        detailUrl: 'https://annas-archive.gl/md5/426e8513e507b07dc42c54fd0f1b4048',
      }),
    ]);
  });

  it('parses detail metadata and slow download links', () => {
    const html = `
      <main class="main"><div class="main-inner">
        <div id="list_cover_aarecord_id__md5:74512907efeea2371b94b2a3fd3d23b9"><img src="//covers.example/cover.jpg"></div>
        <div class="font-semibold text-2xl">Occult Geometry<span> search</span></div>
        <a href="/search?q=A.S. Raleigh" class="text-base">A.S. Raleigh</a>
        <div class="text-gray-800">English [en] · EPUB · 7.2MB · 1942 · Book</div>
        <div class="js-md5-top-box-description">
          <div class="text-xs text-gray-500 uppercase">description</div>
          <div>Awesome interpretation.</div>
        </div>
        <ul class="list-inside">
          <li><a href="/slow_download/74512907efeea2371b94b2a3fd3d23b9/0/0">Slow Partner Server #1</a></li>
        </ul>
        <ul class="list-inside mb-4 ml-1 js-show-external hidden">
          <li><a href="https://z-lib.gd/md5/74512907efeea2371b94b2a3fd3d23b9" class="js-download-link">Z-Library</a></li>
          <li><a href="http://bookszlibb74ugqojhzhg2a63w5i2atv5bqarulgczawnbmsb6s6qead.onion/md5/74512907efeea2371b94b2a3fd3d23b9" class="js-download-link">Z-Library on Tor</a></li>
          <li><a href="/torrents#zlib" class="js-download-link">Bulk torrent downloads</a></li>
        </ul>
      </div></main>
    `;

    const details = parseAnnaBookDetails(html, `${BASE_URL}/md5/74512907efeea2371b94b2a3fd3d23b9`, BASE_URL);

    expect(details).toMatchObject({
      id: '74512907efeea2371b94b2a3fd3d23b9',
      title: 'Occult Geometry',
      author: 'A.S. Raleigh',
      description: 'Awesome interpretation.',
      extension: 'epub',
      cover: 'https://covers.example/cover.jpg',
      slowDownloadUrls: ['https://annas-archive.gl/slow_download/74512907efeea2371b94b2a3fd3d23b9/0/0'],
      mirrorUrls: [],
    });
  });

  it('extracts direct mirrors from slow download pages and reports challenges', () => {
    const mirrors = parseSlowDownloadMirrors(
      '<p class="mb-4 text-xl font-bold"><a href="https://download.example/book.epub">download</a></p>',
      `${BASE_URL}/slow_download/74512907efeea2371b94b2a3fd3d23b9/0/0`,
      BASE_URL,
    );

    expect(mirrors).toEqual(['https://download.example/book.epub']);
    expect(() => parseSlowDownloadMirrors('<title>DDoS-Guard</title>', `${BASE_URL}/slow_download/x`, BASE_URL)).toThrow(AnnaArchiveChallengeError);
  });

  it('does not classify normal result pages as challenges when scripts mention DDoS-Guard caching', () => {
    const html = `
      <title>Art of Spending Money - Search - Anna’s Archive</title>
      <script>// "text/css" for DDOS-GUARD caching.</script>
      <div class="flex pt-3 pb-3 border-b last:border-b-0 border-gray-100">
        <a href="/md5/bb7104fef335c5a3a30d7842e09841eb" class="custom-a block"><img src="/covers/book.jpg"></a>
        <div>
          <div class="line-clamp-[2] text-[9px] font-mono">zlib/no-category/Morgan Housel/The Art of Spending Money.epub</div>
          <a href="/md5/bb7104fef335c5a3a30d7842e09841eb" class="line-clamp-[3] js-vim-focus">The Art of Spending Money</a>
          <a href="/search?q=Morgan Housel" class="block">Morgan Housel</a>
          <a href="/search?q=Penguin Publishing Group" class="block">Penguin Publishing Group, 2025</a>
          <div class="text-gray-800">English [en] · EPUB · 0.7MB · 2025 · Book</div>
        </div>
      </div>
    `;

    expect(isChallengePage(html)).toBe(false);
    expect(parseAnnaSearchResults(html, BASE_URL, 'epub')).toEqual([
      expect.objectContaining({
        id: 'bb7104fef335c5a3a30d7842e09841eb',
        title: 'The Art of Spending Money',
        author: 'Morgan Housel',
        extension: 'epub',
      }),
    ]);
  });
});
