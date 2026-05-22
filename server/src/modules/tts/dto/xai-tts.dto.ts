import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class XaiTtsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  voice?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2)
  speed?: number;
}
