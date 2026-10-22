import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import { BillingInterval } from '@prisma/client';

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxStudents?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxTeachers?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxParents?: number;
    isActive: any;
}