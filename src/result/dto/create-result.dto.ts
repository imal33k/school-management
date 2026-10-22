import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateResultDto {
  @IsString()
  studentId!: string;

  @IsString()
  examinationId!: string;

  @IsString()
  subjectId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  caScore?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  examScore?: number;

  @IsOptional()
  @IsString()
  remark?: string;
}