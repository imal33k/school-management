import {
  IsDateString,
  IsOptional,
} from 'class-validator';

export class UpdateInvoiceDto {
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}