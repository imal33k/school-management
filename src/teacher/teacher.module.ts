import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { TeacherService } from './teacher.service';
import { TeacherController } from './teacher.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { EmailService } from '../common/email.service';

@Module({
  imports: [PlansModule, AuditLogModule],
  controllers: [TeacherController],
  providers: [TeacherService, EmailService],
})
export class TeacherModule {}
