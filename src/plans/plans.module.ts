import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlanLimitService } from './plan-limit.service';

@Module({
  controllers: [PlansController],
  providers: [PlansService, PlanLimitService],
  exports: [PlanLimitService],
})
export class PlansModule {}
