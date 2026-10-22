import { IsNumber, IsString, Min } from 'class-validator';

export class ExamSubject {
  @IsString()
  subjectId!: string;

  @IsNumber()
  @Min(1)
  maxScore!: number;
}