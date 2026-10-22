import { Module } from '@nestjs/common';
import { NotificationService } from './notifications.service';
import { NotificationController } from './notifications.controller';

@Module({
  controllers: [NotificationController],
  providers: [NotificationService],
})
export class NotificationsModule {}
