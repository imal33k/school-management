import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PromotionPreviewQueryDto {
  @IsString()
  fromClassId!: string;

  @IsString()
  toAcademicSessionId!: string;

  // average (%) a student needs to be suggested for promotion. Default 40.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  passMark?: number;
}

export class PromotionEntryDto {
  @IsString()
  studentId!: string;

  @IsIn(['PROMOTED', 'REPEATED', 'GRADUATED', 'TRANSFERRED_OUT'])
  action!: 'PROMOTED' | 'REPEATED' | 'GRADUATED' | 'TRANSFERRED_OUT';

  // required for PROMOTED and REPEATED: the class in the NEW session
  @IsOptional()
  @IsString()
  toClassId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class PromoteDto {
  @IsString()
  toAcademicSessionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => PromotionEntryDto)
  entries!: PromotionEntryDto[];
}

export class ChangeClassDto {
  @IsString()
  toClassId!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  reason!: string;
}

export class TransferOutDto {
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  reason!: string;
}
