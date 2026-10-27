import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class KokoroTtsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  voice!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  model?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2)
  speed?: number;
}
