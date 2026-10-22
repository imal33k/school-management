import { IsString } from 'class-validator'

export class AssignTeacherDto {
  @IsString()
  teacherId!: string;
}