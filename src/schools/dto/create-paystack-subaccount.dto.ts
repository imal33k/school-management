import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreatePaystackSubaccountDto {
  @IsString()
  @Matches(/^[0-9]{2,12}$/)
  settlementBank!: string;

  @IsString()
  @Matches(/^[0-9]{8,20}$/)
  accountNumber!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  accountName!: string;
}
