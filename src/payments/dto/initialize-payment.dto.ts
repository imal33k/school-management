import { IsOptional, IsUUID, IsUrl } from 'class-validator';

export class InitializePaymentDto {
  @IsUUID() studentId!: string;
  @IsOptional() @IsUUID() invoiceId?: string;
  @IsOptional() @IsUrl() callbackUrl?: string;
}
