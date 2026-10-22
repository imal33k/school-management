import { UserRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateSchoolMembershipRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}