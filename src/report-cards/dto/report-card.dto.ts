import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateReportCardsDto {
  @IsString()
  examinationId!: string;
}

export class PublishReportCardsDto {
  @IsString()
  examinationId!: string;

  // Publish even if some students are missing results
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class UpdateRemarksDto {
  // Send an empty string to clear a remark
  @IsOptional()
  @IsString()
  @MaxLength(500)
  teacherRemark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  principalRemark?: string;
}
