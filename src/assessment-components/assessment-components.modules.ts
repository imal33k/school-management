import { Module } from '@nestjs/common';

import { AssessmentComponentsController } from './assessment-components.controller';
import { AssessmentComponentsService } from './assessment-components.service';

@Module({
  controllers: [AssessmentComponentsController],
  providers: [AssessmentComponentsService],
  exports: [AssessmentComponentsService],
})
export class AssessmentComponentsModule {}