import { IsOptional, IsUUID } from 'class-validator';
export class DashboardAggregateQueryDto {
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @IsUUID() studentId?: string;
}
