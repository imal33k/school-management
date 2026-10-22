import { IsOptional, IsUrl } from 'class-validator';
export class InitializeSubscriptionPaymentDto {
  @IsOptional() @IsUrl() callbackUrl?: string;
}
