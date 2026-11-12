import { Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubscriptionLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async processDueSubscriptions(now = new Date()) {
    const pendingPaymentExpiry = new Date(
      now.getTime() - 24 * 60 * 60 * 1000,
    );

    return this.prisma.$transaction(async (tx) => {
      const failedPayments = await tx.subscriptionPayment.updateMany({
        where: {
          status: 'PENDING',
          createdAt: { lte: pendingPaymentExpiry },
        },
        data: { status: 'FAILED' },
      });

      const expiredSubscriptions = await tx.subscription.updateMany({
        where: {
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
          },
          endDate: { lte: now },
        },
        data: { status: SubscriptionStatus.EXPIRED },
      });

      return {
        failedPayments: failedPayments.count,
        expiredSubscriptions: expiredSubscriptions.count,
      };
    });
  }
}
