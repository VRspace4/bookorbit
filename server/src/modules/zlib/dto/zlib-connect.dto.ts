import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ZlibConnectDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  password!: string;
}
