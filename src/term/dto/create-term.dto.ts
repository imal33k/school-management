import {
  IsDateString,
  IsEnum,
  IsString,
  MinLength,
} from 'class-validator';

import { TermType } from '@prisma/client';

export class CreateTermDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEnum(TermType)
  type!: TermType;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}