import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// One mark: "CA1 = 15"
export class ComponentScoreDto {
  @IsString()
  componentId!: string;

  @IsNumber()
  @Min(0)
  score!: number;
}

// One student's marks for this subject
export class BulkResultEntryDto {
  @IsString()
  studentId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ComponentScoreDto)
  scores!: ComponentScoreDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;
}

// A whole class's marks for one subject in one exam
export class BulkResultDto {
  @IsString()
  examinationId!: string;

  @IsString()
  subjectId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BulkResultEntryDto)
  entries!: BulkResultEntryDto[];
}

// For GET /result/sheet?examinationId=...&subjectId=...
export class ResultSheetQueryDto {
  @IsString()
  examinationId!: string;

  @IsString()
  subjectId!: string;
}
