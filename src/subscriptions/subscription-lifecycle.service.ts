import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubscriptionLifecycleService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SubscriptionLifecycleService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.expireDueSubscriptions();
    this.timer = setInterval(
      () => void this.expireDueSubscriptions(),
      15 * 60 * 1000,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async expireDueSubscriptions() {
    try {
      await this.prisma.subscription.updateMany({
        where: {
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
          },
          endDate: { lte: new Date() },
        },
        data: { status: SubscriptionStatus.EXPIRED },
      });
    } catch (error) {
      this.logger.error(
        'Failed to expire due subscriptions',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
