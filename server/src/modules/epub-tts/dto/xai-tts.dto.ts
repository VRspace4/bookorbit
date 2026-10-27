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

  /** Desired speaking-rate multiplier. Clamped to xAI's 0.7–1.5 range in the service. */
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(3)
  speed?: number;
}
