import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ZlibQueueAddDto {
  @IsString()
  bookId: string;

  @IsString()
  hash: string;

  @IsString()
  @MaxLength(500)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  author?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  format?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  cover?: string;
}
