import { UserRole } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateSchoolUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() @MinLength(2) firstName!: string;
  @IsString() @MinLength(2) lastName!: string;
  @IsOptional() @IsString() phone?: string;
  @IsEnum(UserRole) role!: UserRole;
  @IsOptional() @IsUUID() schoolId?: string;
  @IsOptional() @IsString() admissionNumber?: string;
}
