import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class SaveProgressDto {
  @IsString()
  document!: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  percentage!: number;

  @IsString()
  @IsOptional()
  progress?: string;

  @IsString()
  @IsOptional()
  device?: string;

  @IsString()
  @IsOptional()
  device_id?: string;

  @IsNumber()
  @IsOptional()
  timestamp?: number;
}
