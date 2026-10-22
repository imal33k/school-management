import {
  IsDateString,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateAcademicSessionDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}