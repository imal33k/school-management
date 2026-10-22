import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import { ExaminationStatus } from '@prisma/client';

export class CreateExaminationDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  termId!: string;

  @IsUUID()
  classId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsEnum(ExaminationStatus)
  status?: ExaminationStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}