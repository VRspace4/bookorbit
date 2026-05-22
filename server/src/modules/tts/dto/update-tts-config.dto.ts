import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class TtsProviderConfigEntryDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  apiKey?: string;
}

export class AzureTtsProviderConfigEntryDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string;
}

export class UpdateTtsConfigDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AzureTtsProviderConfigEntryDto)
  azure?: AzureTtsProviderConfigEntryDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TtsProviderConfigEntryDto)
  gcpChirp3?: TtsProviderConfigEntryDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TtsProviderConfigEntryDto)
  xai?: TtsProviderConfigEntryDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TtsProviderConfigEntryDto)
  kokoro?: TtsProviderConfigEntryDto;
}
