import { IsString } from 'class-validator';

export class AssignSubjectDto {
  @IsString()
  subjectId!: string;
}