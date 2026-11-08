import { describe, expect, it, jest } from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service';
import { PlanLimitService } from './plan-limit.service';

describe('PlanLimitService subscription bypass', () => {
  it('skips subscription and plan-limit checks when temporary testing is enabled', async () => {
    const previousValue = process.env.BYPASS_SUBSCRIPTION_CHECK;
    process.env.BYPASS_SUBSCRIPTION_CHECK = 'true';
    const prisma = {
      subscription: {
        findUnique: jest.fn(),
      },
    } as unknown as PrismaService;
    const service = new PlanLimitService(prisma);

    try {
      await expect(
        service.ensureCanCreate('school-1', 'students'),
      ).resolves.toBeUndefined();
      await expect(service.ensureSubscriptionActive('school-1')).resolves.toBe(
        null,
      );
      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    } finally {
      if (previousValue === undefined) {
        delete process.env.BYPASS_SUBSCRIPTION_CHECK;
      } else {
        process.env.BYPASS_SUBSCRIPTION_CHECK = previousValue;
      }
    }
  });
});
