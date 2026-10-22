import { Module } from '@nestjs/common';
import { ExaminationsService } from './examination.service';
import { ExaminationsController } from './examination.controller';

@Module({
  controllers: [ExaminationsController],
  providers: [ExaminationsService],
})
export class ExaminationModule {}
