import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
