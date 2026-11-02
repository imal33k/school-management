import {
  IsEmail,
  IsNotEmpty,
  IsString,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @ValidateIf((dto: LoginDto) => !dto.schoolemail)
  @IsEmail()
  @IsNotEmpty()
  email?: string;

  @ValidateIf((dto: LoginDto) => !dto.email)
  @IsEmail()
  @IsNotEmpty()
  schoolemail?: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}