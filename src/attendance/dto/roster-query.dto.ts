import { Matches } from 'class-validator';

export class RosterQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must look like 2026-11-05',
  })
  date!: string;
}