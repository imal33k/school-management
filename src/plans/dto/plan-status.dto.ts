import { IsBoolean } from 'class-validator';

export class UpdatePlanStatusDto {
  @IsBoolean()
  isActive!: boolean;
}