import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

// One line of the roll call: one student and their status.
export class BulkAttendanceRecordDto {
  @IsString()
  studentId!: string;

  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  @IsOptional()
  @IsString()
  note?: string;
}

// The whole roll call: one class, one day, many students.
export class BulkAttendanceDto {
  @IsString()
  classId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must look like 2026-11-05',
  })
  date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkAttendanceRecordDto)
  records!: BulkAttendanceRecordDto[];
}