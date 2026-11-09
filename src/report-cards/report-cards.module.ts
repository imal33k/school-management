import { Module } from '@nestjs/common';

import { AssessmentComponentsModule } from '../assessment-components/assessment-components.modules';
import { GradingModule } from '../grading/grading.module';
import { ReportCardsController } from './report-cards.controller';
import { ReportCardsService } from './report-cards.service';

@Module({
  imports: [GradingModule, AssessmentComponentsModule],
  controllers: [ReportCardsController],
  providers: [ReportCardsService],
})
export class ReportCardsModule {}
