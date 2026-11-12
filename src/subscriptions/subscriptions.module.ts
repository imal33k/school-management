import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PaymentsModule } from '../payments/payments.module';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { PlansModule } from '../plans/plans.module';

@Module({
  imports: [PaymentsModule, PlansModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionLifecycleService],
  exports: [SubscriptionLifecycleService],
})
export class SubscriptionsModule {}
