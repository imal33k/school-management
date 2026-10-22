import { Module } from '@nestjs/common';
import { TimetableService } from './timetable-entry.service';
import { TimetableController } from './timetable-entry.controller';

@Module({
  controllers: [TimetableController],
  providers: [TimetableService],
})
export class TimetableEntryModule {}
export { TimetableService };

