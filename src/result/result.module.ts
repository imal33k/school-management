import { Module } from '@nestjs/common';
import { ResultsService } from './result.service';
import { ResultBulkService } from './result-bulk.service';
import { ResultController } from './result.controller';
import { GradingModule } from '../grading/grading.module';
import { AssessmentComponentsModule } from '../assessment-components/assessment-components.modules';

@Module({
  imports: [GradingModule, AssessmentComponentsModule],
  controllers: [ResultController],
  providers: [ResultsService, ResultBulkService],
})
export class ResultModule {}
