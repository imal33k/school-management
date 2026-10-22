import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;

  get paginated() { return this.page !== undefined || this.limit !== undefined || !!this.search; }
  getPage() { return this.page ?? 1; }
  getLimit() { return this.limit ?? 20; }
}
