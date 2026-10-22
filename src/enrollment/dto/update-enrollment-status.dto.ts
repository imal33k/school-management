import { IsEnum } from 'class-validator';

import { EnrollmentStatus } from '@prisma/client';

export class UpdateEnrollmentStatusDto {
  @IsEnum(EnrollmentStatus)
  status!: EnrollmentStatus;
}