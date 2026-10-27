import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GcpChirp3TtsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  voice!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  languageCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(2)
  speakingRate?: number;
}
