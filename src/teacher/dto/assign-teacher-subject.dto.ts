import { IsUUID } from 'class-validator';

export class AssignTeacherSubjectDto {
  @IsUUID()
  subjectId!: string;
}
