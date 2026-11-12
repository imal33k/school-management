import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { SchoolMembershipService } from './school-membership.service';
import { SchoolMembershipController } from './school-membership.controller';
import { EmailModule } from '../common/email.module';

@Module({
  imports: [PlansModule, EmailModule],
  controllers: [SchoolMembershipController],
  providers: [SchoolMembershipService],
})
export class SchoolMembershipModule {}
