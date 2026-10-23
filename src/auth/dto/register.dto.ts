import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  schoolemail!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsNotEmpty()
  schoolName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

 
  @IsOptional()
  @IsString()
  schooladdress?: string;
}
