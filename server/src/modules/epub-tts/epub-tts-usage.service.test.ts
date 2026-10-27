import { EpubTtsUsageService } from './epub-tts-usage.service';
import { EpubTtsUsageRepository } from './epub-tts-usage.repository';

describe('EpubTtsUsageService', () => {
  let service: EpubTtsUsageService;
  let repo: Pick<EpubTtsUsageRepository, 'findForUserAndMonth' | 'increment'>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T12:00:00Z'));

    repo = {
      findForUserAndMonth: vi.fn().mockResolvedValue([
        { provider: 'kokoro', characterCount: 1500 },
        { provider: 'xai', characterCount: 250_000 },
      ]),
      increment: vi.fn().mockResolvedValue(undefined),
    };
    service = new EpubTtsUsageService(repo as EpubTtsUsageRepository);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns monthly usage with zero defaults', async () => {
    await expect(service.getMonthlyUsage(7)).resolves.toEqual({
      browser: 0,
      azure: 0,
      'gcp-chirp3': 0,
      xai: 250_000,
      kokoro: 1500,
      'gpt-4o-mini-tts': 0,
    });
    expect(repo.findForUserAndMonth).toHaveBeenCalledWith(7, '2026-05-01');
  });

  it('records provider usage for the current month', async () => {
    await service.recordUsage(3, 'gcp-chirp3', 42);
    expect(repo.increment).toHaveBeenCalledWith(3, 'gcp-chirp3', '2026-05-01', 42);
  });
});
