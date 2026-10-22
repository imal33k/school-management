import { Module } from '@nestjs/common';
import { SubjectsService } from './subject.service';
import { SubjectController } from './subject.controller';

@Module({
  controllers: [SubjectController],
  providers: [SubjectsService],
})
export class SubjectModule {}
