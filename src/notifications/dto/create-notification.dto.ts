import { IsArray, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { NotificationType, UserRole } from '@prisma/client';

export class CreateNotificationDto {
  @IsString() title!: string;
  @IsString() message!: string;
  @IsEnum(NotificationType) type!: NotificationType;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) recipientUserIds?: string[];
  @IsOptional() @IsArray() @IsEnum(UserRole, { each: true }) recipientRoles?: UserRole[];
}
