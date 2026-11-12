import { Module } from '@nestjs/common';
import { PlansModule } from '../../plans/plans.module';
import { GuardianService } from './guardian.service';
import { GuardianController } from './guardian.controller';
import { TimetableEntryModule } from '../../timetable-entry/timetable-entry.module';

@Module({
  imports: [PlansModule, TimetableEntryModule],
  controllers: [GuardianController],
  providers: [GuardianService],
})
export class GuardianModule {}
