import { describe, expect, it, jest } from '@jest/globals';
import { MessageChannel, MessageStatus } from '@prisma/client';
import { EmailService } from '../common/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessageDeliveryService } from './message-delivery.service';

describe('MessageDeliveryService', () => {
  function setup() {
    const delivery = {
      id: 'delivery-1',
      channel: MessageChannel.EMAIL,
      to: 'parent@example.com',
      subject: 'Invoice reminder',
      body: 'Please review your invoice',
      attempts: 1,
    };
    const tx = {
      messageDelivery: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: jest.fn(async () => delivery),
      },
    };
    const prisma = {
      messageDelivery: {
        findMany: jest.fn(async () => [{ id: delivery.id }]),
        update: jest.fn(async () => ({})),
      },
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const email = {
      send: jest.fn(async () => undefined),
    };
    return {
      service: new MessageDeliveryService(
        prisma as unknown as PrismaService,
        email as unknown as EmailService,
      ),
      prisma,
      email,
      tx,
    };
  }

  it('claims a queued email before sending and marks it sent', async () => {
    const { service, prisma, email, tx } = setup();

    await expect(
      service.dispatchPendingBatch(new Date('2026-11-12T10:00:00.000Z')),
    ).resolves.toEqual({ considered: 1, sent: 1, failed: 0, skipped: 0 });

    expect(tx.messageDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'delivery-1',
          OR: expect.any(Array),
        }),
        data: expect.objectContaining({
          status: MessageStatus.PROCESSING,
          attempts: { increment: 1 },
        }),
      }),
    );
    expect(email.send).toHaveBeenCalledWith(
      'parent@example.com',
      'Invoice reminder',
      'Please review your invoice',
    );
    expect(prisma.messageDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          status: MessageStatus.SENT,
          claimedAt: null,
        }),
      }),
    );
  });

  it('does not send a row claimed by another worker', async () => {
    const { service, email, tx } = setup();
    tx.messageDelivery.updateMany.mockImplementation(async () => ({
      count: 0,
    }));

    await expect(service.dispatchPendingBatch()).resolves.toEqual({
      considered: 1,
      sent: 0,
      failed: 0,
      skipped: 1,
    });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('requeues failed email delivery with a retry time', async () => {
    const { service, prisma, email } = setup();
    email.send.mockImplementation(async () => {
      throw new Error('SMTP temporarily unavailable');
    });
    const now = new Date('2026-11-12T10:00:00.000Z');

    await expect(service.dispatchPendingBatch(now)).resolves.toMatchObject({
      failed: 1,
      sent: 0,
    });

    expect(prisma.messageDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MessageStatus.PENDING,
          nextAttemptAt: new Date('2026-11-12T10:01:00.000Z'),
        }),
      }),
    );
  });
});
