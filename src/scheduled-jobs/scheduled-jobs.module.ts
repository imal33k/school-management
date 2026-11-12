import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ScheduledJobsService } from './scheduled-jobs.service';

@Module({
  imports: [BillingModule, NotificationsModule, SubscriptionsModule],
  providers: [ScheduledJobsService],
})
export class ScheduledJobsModule {}
