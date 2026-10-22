import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { TermType } from '@prisma/client';

export class UpdateTermDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsEnum(TermType) type?: TermType;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}
