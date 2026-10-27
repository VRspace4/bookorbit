import { IsIn, IsInt, Max, Min } from 'class-validator';
import { TTS_PROVIDERS, type TtsProvider } from '@bookorbit/types';

export class RecordTtsUsageDto {
  @IsIn(TTS_PROVIDERS)
  provider!: TtsProvider;

  @IsInt()
  @Min(1)
  @Max(5000)
  characters!: number;
}
