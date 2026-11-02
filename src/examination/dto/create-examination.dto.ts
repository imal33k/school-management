import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

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
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}