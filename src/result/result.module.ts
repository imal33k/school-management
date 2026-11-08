import { Module } from '@nestjs/common';
import { ResultsService } from './result.service';
import { ResultController } from './result.controller';
import { GradingModule } from '../grading/grading.module';

@Module({
  imports: [GradingModule],
  controllers: [ResultController],
  providers: [ResultsService],
})
export class ResultModule {}