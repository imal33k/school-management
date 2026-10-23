import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {


  @IsEmail()
  @IsNotEmpty()
  schoolemail!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}