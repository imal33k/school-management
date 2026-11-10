import { Module } from '@nestjs/common';

import { StudentAccessService } from './student-access.service';

@Module({
  providers: [StudentAccessService],
  exports: [StudentAccessService],
})
export class StudentAccessModule {}
