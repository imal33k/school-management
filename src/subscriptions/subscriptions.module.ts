import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PaymentsModule } from '../payments/payments.module';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

@Module({
  imports: [PaymentsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionLifecycleService],
})
export class SubscriptionsModule {}
