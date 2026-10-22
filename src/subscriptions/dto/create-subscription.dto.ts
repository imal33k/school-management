import {
  IsDateString,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}