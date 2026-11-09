import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// One slice of a score, e.g. "CA1" out of 20, or "Exam" out of 60.
export class CreateAssessmentComponentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsNumber()
  @Min(0.01)
  @Max(1000)
  maxScore!: number;

  // true for the exam slice. A school can have only one active exam slice.
  @IsOptional()
  @IsBoolean()
  isExam?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class UpdateAssessmentComponentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  maxScore?: number;

  @IsOptional()
  @IsBoolean()
  isExam?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}