import {
  IsDateString,
  IsOptional,
} from 'class-validator';

export class AttendanceQueryDto {
  @IsOptional()
  @IsDateString()
  date?: string;
}