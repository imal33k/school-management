import { IsOptional, IsUrl, IsUUID } from 'class-validator';
export class InitializeSubscriptionPaymentDto {
  @IsOptional() @IsUrl() callbackUrl?: string;
  @IsOptional() @IsUUID() planId?: string;
}
