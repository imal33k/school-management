import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

import { DayOfWeek } from '@prisma/client';

export class CreateTimetableEntryDto {
  @IsString()
  classId!: string;

  @IsString()
  subjectId!: string;

  @IsOptional()
  @IsString()
  teacherId?: string;

  @IsEnum(DayOfWeek)
  day!: DayOfWeek;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm' })
  startTime!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:mm' })
  endTime!: string;

  @IsOptional()
  @IsString()
  room?: string;
}