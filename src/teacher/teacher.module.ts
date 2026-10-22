import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { TeacherService } from './teacher.service';
import { TeacherController } from './teacher.controller';

@Module({
  imports: [PlansModule],
  controllers: [TeacherController],
  providers: [TeacherService],
})
export class TeacherModule {}
