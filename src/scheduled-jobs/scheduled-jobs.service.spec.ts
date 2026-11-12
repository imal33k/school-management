import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  InvoiceStatus,
  MessageChannel,
  Prisma,
  SchoolStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { MessageDeliveryService } from '../notifications/message-delivery.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';
import { OverdueInvoicesService } from '../billing/overdue-invoices.service';
import { ScheduledJobsService } from './scheduled-jobs.service';

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ScheduledJobsService local reminders', () => {
  function setup(timezone = 'Africa/Lagos') {
    const school = {
      id: 'school-1',
      name: 'Example School',
      timezone,
      email: 'billing@example.test',
      currency: 'NGN',
      messageChannels: [MessageChannel.EMAIL],
      status: SchoolStatus.ACTIVE,
    };
    const invoice = {
      id: 'invoice-1',
      invoiceNumber: 'INV-2026-1',
      amount: new Prisma.Decimal('1200.00'),
      amountPaid: new Prisma.Decimal('200.00'),
      dueDate: new Date('2026-11-15T00:00:00.000Z'),
      student: {
        firstName: 'Ada',
        lastName: 'Student',
        email: 'ada@example.test',
        user: { email: null },
        guardians: [
          {
            parent: {
              email: 'parent@example.test',
              user: { email: null },
            },
          },
        ],
      },
    };
    const subscription = {
      id: 'subscription-1',
      endDate: new Date('2026-11-19T10:00:00.000Z'),
      status: SubscriptionStatus.ACTIVE,
      plan: { name: 'Standard' },
      school: {
        memberships: [{ user: { email: 'admin@example.test' } }],
      },
    };
    const prisma = {
      school: {
        findMany: jest.fn(async () => [school]),
      },
      invoice: {
        findMany: jest.fn(async () => [invoice]),
      },
      subscription: {
        findMany: jest.fn(async () => [subscription]),
      },
    };
    const enqueued: Prisma.MessageDeliveryCreateManyInput[][] = [];
    const messageDelivery = {
      enqueue: jest.fn(
        async (data: Prisma.MessageDeliveryCreateManyInput[]) => {
          enqueued.push(data);
          return { count: data.length };
        },
      ),
    };
    const service = new ScheduledJobsService(
      prisma as unknown as PrismaService,
      {} as OverdueInvoicesService,
      {} as SubscriptionLifecycleService,
      messageDelivery as unknown as MessageDeliveryService,
    );

    return { service, prisma, enqueued, school, invoice };
  }

  it('queues deduplicated invoice and subscription emails at 7 AM school time', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-12T06:00:00.000Z'));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service, prisma, enqueued } = setup();

    await service.queueSchoolLocalReminders();

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [
              InvoiceStatus.UNPAID,
              InvoiceStatus.PARTIALLY_PAID,
              InvoiceStatus.OVERDUE,
            ],
          },
        }),
      }),
    );

    const invoiceMessages = enqueued[0];
    expect(invoiceMessages).toHaveLength(2);
    expect(invoiceMessages[0]).toMatchObject({
      to: 'ada@example.test',
      event: 'invoice-reminder',
      dedupeKey: expect.stringContaining('due-in-3-days'),
    });
    expect(invoiceMessages[0].body).toContain('Amount due: NGN 1000.00');
    expect(enqueued[1]).toHaveLength(2);
    expect(enqueued[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: 'billing@example.test',
          event: 'subscription-reminder',
        }),
        expect.objectContaining({
          to: 'admin@example.test',
          event: 'subscription-reminder',
        }),
      ]),
    );
  });

  it('does not queue school reminders outside 7 AM in that school timezone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-12T06:00:00.000Z'));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service, prisma, enqueued } = setup('UTC');

    await service.queueSchoolLocalReminders();

    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
    expect(enqueued).toHaveLength(0);
  });
});
