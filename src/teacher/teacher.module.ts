import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { TeacherService } from './teacher.service';
import { TeacherController } from './teacher.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { EmailModule } from '../common/email.module';

@Module({
  imports: [PlansModule, AuditLogModule, EmailModule],
  controllers: [TeacherController],
  providers: [TeacherService],
})
export class TeacherModule {}
