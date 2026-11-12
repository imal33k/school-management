import { Module } from '@nestjs/common';

import { StudentAccessModule } from '../student-access/student-access.module';
import { StudentLifecycleController } from './student-lifecycle.controller';
import { StudentLifecycleService } from './student-lifecycle.service';

@Module({
  imports: [StudentAccessModule],
  controllers: [StudentLifecycleController],
  providers: [StudentLifecycleService],
})
export class StudentLifecycleModule {}