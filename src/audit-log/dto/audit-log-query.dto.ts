import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
export class AuditLogQueryDto {
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() resource?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}
