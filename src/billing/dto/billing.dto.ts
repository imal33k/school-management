import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DiscountType } from '@prisma/client';

// ---------- Discounts ----------
export class CreateDiscountDto {
  @IsString()
  studentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsEnum(DiscountType)
  type!: DiscountType;

  @IsNumber()
  @Min(0.01)
  @Max(100000000)
  value!: number;

  // leave out = applies to every fee
  @IsOptional()
  @IsString()
  feeStructureId?: string;

  // leave out = applies to every term
  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class UpdateDiscountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100000000)
  value?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

// ---------- Bulk invoicing ----------
export class BatchInvoiceDto {
  @IsString()
  termId!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  classId?: string;

  @IsOptional()
  @IsString()
  levelId?: string;

  // leave out = every fee structure of the term
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  feeStructureIds?: string[];
}

// ---------- Fee scope ----------
export class SetFeeScopeDto {
  @IsOptional()
  @IsString()
  classId?: string | null;

  @IsOptional()
  @IsString()
  levelId?: string | null;
}

// ---------- Installments ----------
export class InstallmentItemDto {
  @IsDateString()
  dueDate!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;
}

export class InstallmentPlanDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => InstallmentItemDto)
  items!: InstallmentItemDto[];
}

// ---------- Refunds ----------
export class CreateRefundDto {
  @IsString()
  paymentId!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  reason!: string;
}

export class UpdateRefundStatusDto {
  @IsEnum({ COMPLETED: 'COMPLETED', FAILED: 'FAILED' })
  status!: 'COMPLETED' | 'FAILED';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  failureReason?: string;
}
