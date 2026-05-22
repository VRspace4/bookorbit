import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ZlibDownloadDto {
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
}
