import { UserRole } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateSchoolInvitationDto {
  @IsEmail()
  email!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  employeeId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  admissionNumber?: string;
}
