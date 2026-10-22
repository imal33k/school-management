import {
  IsBoolean,
  IsEnum,
  IsString,
} from 'class-validator';

import { RelationshipType } from '@prisma/client';

export class LinkStudentDto {
  @IsString()
  studentId!: string;

  @IsEnum(RelationshipType)
  relationship!: RelationshipType;

  @IsBoolean()
  isPrimary!: boolean;
}