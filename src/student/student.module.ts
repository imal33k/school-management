import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { StudentService } from './student.service';
import { StudentController } from './student.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [PlansModule],
  controllers: [StudentController],
  providers: [StudentService],
})
export class StudentModule {}
