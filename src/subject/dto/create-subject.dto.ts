import { IsOptional, IsString } from 'class-validator'
export class CreateSubjectDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;
}

