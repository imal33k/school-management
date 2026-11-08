import { Matches } from 'class-validator';

export class SummaryQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'from must look like 2026-09-01',
  })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'to must look like 2026-12-18',
  })
  to!: string;
}