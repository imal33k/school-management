import { createHmac } from 'crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentStatus, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PaystackService } from './paystack.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService Paystack state transitions', () => {
  const payment = {
    id: 'payment-1',
    reference: 'PAY-1',
    amount: new Prisma.Decimal(10),
    invoiceId: null,
    status: PaymentStatus.REFUNDED,
  };
  const tx = {
    payment: {
      updateMany: jest.fn<(...args: unknown[]) => Promise<{ count: number }>>(),
      findUniqueOrThrow: jest
        .fn<(...args: unknown[]) => Promise<typeof payment>>(),
    },
    subscriptionPayment: {
      updateMany: jest.fn<(...args: unknown[]) => Promise<{ count: number }>>(),
      findUniqueOrThrow: jest
        .fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    subscription: {
      findUniqueOrThrow: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      update: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    plan: {
      findUniqueOrThrow: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
  };
  const prismaMock = {
    payment: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<typeof payment | null>>(),
    },
    subscriptionPayment: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    $transaction: jest.fn(
      (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    ),
  };
  const paymentsService = new PaymentsService(
    prismaMock as unknown as PrismaService,
    {} as PaystackService,
  );
  const secret = 'test-paystack-secret';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = secret;
    prismaMock.payment.findUnique.mockResolvedValue(payment);
    prismaMock.subscriptionPayment.findUnique.mockResolvedValue(null);
    tx.payment.updateMany.mockResolvedValue({ count: 0 });
    tx.payment.findUniqueOrThrow.mockResolvedValue(payment);
  });

  async function sendWebhook(status: string) {
    const body = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: payment.reference,
        status,
        gateway_response: 'Approved',
        amount: 1000,
      },
    });
    const rawBody = Buffer.from(body);
    const signature = createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');
    const request = {
      headers: { 'x-paystack-signature': signature },
      rawBody,
      body: JSON.parse(body),
    } as unknown as RawBodyRequest<Request>;

    return paymentsService.handleWebhook(request);
  }

  it('does not overwrite a refunded payment after a late success event', async () => {
    await sendWebhook('success');

    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: payment.id,
          status: {
            in: [PaymentStatus.PENDING, PaymentStatus.FAILED],
          },
        },
      }),
    );
    expect(tx.payment.findUniqueOrThrow).toHaveBeenCalled();
  });

  it('keeps a payment pending when Paystack reports a non-final status', async () => {
    await sendWebhook('pending');

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });
});
