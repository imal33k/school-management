import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// One row of a grading scale, e.g. grade "A", from 70 upwards.
export class GradeBandDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  grade!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  minScore!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  remark?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  points?: number;
}

export class CreateGradeScaleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => GradeBandDto)
  bands!: GradeBandDto[];
}

export class UpdateGradeScaleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  // If you send bands, they REPLACE all the old bands of this scale.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => GradeBandDto)
  bands?: GradeBandDto[];
}