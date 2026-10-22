import {
  IsEnum,
} from 'class-validator';

import { SubscriptionStatus } from '@prisma/client';

export class UpdateSubscriptionStatusDto {
  @IsEnum(SubscriptionStatus)
  status!: SubscriptionStatus;
}