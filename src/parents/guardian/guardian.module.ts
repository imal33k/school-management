import { Module } from '@nestjs/common';
import { PlansModule } from '../../plans/plans.module';
import { GuardianService } from './guardian.service';
import { GuardianController } from './guardian.controller';

@Module({
  imports: [PlansModule],
  controllers: [GuardianController],
  providers: [GuardianService],
})
export class GuardianModule {}
