import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

import { DayOfWeek } from '@prisma/client';

export class UpdateTimetableEntryDto {
  @IsOptional()
  @IsString()
  classId?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsString()
  teacherId?: string;

  @IsOptional()
  @IsEnum(DayOfWeek)
  day?: DayOfWeek;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime?: string;

  @IsOptional()
  @IsString()
  room?: string;
}