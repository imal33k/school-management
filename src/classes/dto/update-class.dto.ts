import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateClassDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}
