import { Module } from '@nestjs/common';
import { ResultsService } from './result.service';
import { ResultController } from './result.controller';

@Module({
  controllers: [ResultController],
  providers: [ResultsService],
})
export class ResultModule {}
