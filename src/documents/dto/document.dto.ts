import { DocumentKind } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

// The text fields sent alongside the file
export class UploadDocumentDto {
  @IsOptional()
  @IsEnum(DocumentKind)
  kind?: DocumentKind;

  // what to call it; defaults to the file's own name
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
