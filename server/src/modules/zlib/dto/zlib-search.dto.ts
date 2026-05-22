import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ZlibSearchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  q!: string;

  @IsOptional()
  @IsIn(['epub', 'pdf', 'mobi', 'fb2', 'djvu', 'cbz', 'cbr', 'azw3'])
  format?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
