import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EnquiryType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateEnquiryDto {
  @IsOptional()
  @IsEnum(EnquiryType)
  type?: EnquiryType;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'name must be at least 2 characters' })
  @MaxLength(120)
  name!: string;

  @Transform(trim)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(200)
  email!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  schoolName?: string;

  @Transform(trim)
  @IsString()
  @MinLength(10, { message: 'message must be at least 10 characters' })
  @MaxLength(4000)
  message!: string;

  /** Honeypot. Real visitors never see or fill this; bots usually do. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
