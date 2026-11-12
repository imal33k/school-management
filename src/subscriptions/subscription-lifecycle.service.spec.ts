import { describe, expect, it, jest } from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

describe('SubscriptionLifecycleService', () => {
  it('expires stale payments and ended subscriptions in one transaction', async () => {
    const tx = {
      subscriptionPayment: {
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
      subscription: {
        updateMany: jest.fn(async () => ({ count: 3 })),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const service = new SubscriptionLifecycleService(
      prisma as unknown as PrismaService,
    );
    const now = new Date('2026-11-12T10:00:00.000Z');

    await expect(service.processDueSubscriptions(now)).resolves.toEqual({
      failedPayments: 2,
      expiredSubscriptions: 3,
    });
    expect(tx.subscriptionPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { lte: new Date('2026-11-11T10:00:00.000Z') },
        }),
      }),
    );
    expect(tx.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ endDate: { lte: now } }),
      }),
    );
  });
});
