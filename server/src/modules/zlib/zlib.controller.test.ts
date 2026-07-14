import { Readable } from 'stream';
import { UnauthorizedException } from '@nestjs/common';

import { ZlibController } from './zlib.controller';

const MOCK_USER = { id: 7 } as any;

function makeController() {
  const zlibApi = {
    search: vi.fn(),
    downloadStream: vi.fn(),
    login: vi.fn(),
  };
  const annaArchiveApi = {
    search: vi.fn(),
    downloadStream: vi.fn(),
    downloadMirrorStream: vi.fn(),
  };
  const credentials = {
    findByUserId: vi.fn(),
    resetCountIfExpired: vi.fn(),
    incrementDownloadCount: vi.fn(),
    markLimitHit: vi.fn(),
    upsert: vi.fn(),
    deleteByUserId: vi.fn(),
  };
  const queue = {
    getQueue: vi.fn(),
    addToQueue: vi.fn(),
    removeFromQueue: vi.fn(),
    retryFailed: vi.fn(),
    drainForUser: vi.fn(),
  };
  const bookDockIngest = {
    ingestUpload: vi.fn(),
  };

  const controller = new ZlibController(zlibApi as never, annaArchiveApi as never, credentials as never, queue as never, bookDockIngest as never);

  return { controller, zlibApi, annaArchiveApi, credentials, queue, bookDockIngest };
}

describe('ZlibController source routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('searches Anna without requiring Z-Library credentials', async () => {
    const { controller, annaArchiveApi, credentials } = makeController();
    annaArchiveApi.search.mockResolvedValue({ books: [], total: 0 });

    await expect(controller.search({ source: 'anna', q: 'public domain', format: 'epub', limit: 10 }, MOCK_USER)).resolves.toEqual({
      books: [],
      total: 0,
    });

    expect(annaArchiveApi.search).toHaveBeenCalledWith('public domain', 'epub', 10);
    expect(credentials.findByUserId).not.toHaveBeenCalled();
  });

  it('keeps Z-Library credential enforcement for default searches', async () => {
    const { controller } = makeController();

    await expect(controller.search({ q: 'book' }, MOCK_USER)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('downloads Anna books directly into Book Dock', async () => {
    const { controller, annaArchiveApi, bookDockIngest, credentials } = makeController();
    const stream = Readable.from('book');
    annaArchiveApi.downloadStream.mockResolvedValue({ stream, filename: 'Resolved.epub' });
    bookDockIngest.ingestUpload.mockResolvedValue(42);

    await expect(
      controller.download(
        {
          source: 'anna',
          bookId: '426e8513e507b07dc42c54fd0f1b4048',
          hash: '426e8513e507b07dc42c54fd0f1b4048',
          filename: 'Public Domain.epub',
          format: 'epub',
        },
        MOCK_USER,
      ),
    ).resolves.toEqual({ bookDockId: 42 });

    expect(annaArchiveApi.downloadStream).toHaveBeenCalledWith('426e8513e507b07dc42c54fd0f1b4048', 'epub');
    expect(bookDockIngest.ingestUpload).toHaveBeenCalledWith('Public Domain.epub', stream, MOCK_USER.id);
    expect(credentials.findByUserId).not.toHaveBeenCalled();
  });

  it('downloads Anna books from browser-resolved mirrors into Book Dock', async () => {
    const { controller, annaArchiveApi, bookDockIngest, credentials } = makeController();
    const stream = Readable.from('book');
    annaArchiveApi.downloadMirrorStream.mockResolvedValue({ stream, filename: 'Resolved.epub' });
    bookDockIngest.ingestUpload.mockResolvedValue(42);

    await expect(
      controller.download(
        {
          source: 'anna',
          bookId: '426e8513e507b07dc42c54fd0f1b4048',
          hash: '426e8513e507b07dc42c54fd0f1b4048',
          filename: 'Public Domain.epub',
          format: 'epub',
          mirrorUrls: ['https://download.example/book.epub'],
        },
        MOCK_USER,
      ),
    ).resolves.toEqual({ bookDockId: 42 });

    expect(annaArchiveApi.downloadMirrorStream).toHaveBeenCalledWith(['https://download.example/book.epub'], 'Public Domain.epub', 'epub');
    expect(annaArchiveApi.downloadStream).not.toHaveBeenCalled();
    expect(bookDockIngest.ingestUpload).toHaveBeenCalledWith('Public Domain.epub', stream, MOCK_USER.id);
    expect(credentials.findByUserId).not.toHaveBeenCalled();
  });
});
