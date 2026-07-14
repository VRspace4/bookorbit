import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import type { ExternalBookSource } from './zlib-search.dto';

export class ZlibDownloadDto {
  @IsOptional()
  @IsIn(['zlib', 'anna'])
  source?: ExternalBookSource;

  @IsString()
  @IsNotEmpty()
  bookId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  hash!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  filename!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  format!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  mirrorUrls?: string[];
}
