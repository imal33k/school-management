import { Module } from '@nestjs/common';
import { NotificationService } from './notifications.service';
import { NotificationController } from './notifications.controller';
import { EmailModule } from '../common/email.module';
import { MessageDeliveryService } from './message-delivery.service';

@Module({
  imports: [EmailModule],
  controllers: [NotificationController],
  providers: [NotificationService, MessageDeliveryService],
  exports: [MessageDeliveryService],
})
export class NotificationsModule {}
