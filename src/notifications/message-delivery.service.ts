import { Injectable, Logger } from '@nestjs/common';
import { MessageChannel, MessageStatus, Prisma } from '@prisma/client';
import { EmailService } from '../common/email.service';
import { PrismaService } from '../prisma/prisma.service';

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

@Injectable()
export class MessageDeliveryService {
  private readonly logger = new Logger(MessageDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async enqueue(data: Prisma.MessageDeliveryCreateManyInput[]) {
    if (data.length === 0) return { count: 0 };
    return this.prisma.messageDelivery.createMany({
      data,
      skipDuplicates: true,
    });
  }

  async dispatchPendingBatch(now = new Date()) {
    const staleClaimBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
    const candidates = await this.prisma.messageDelivery.findMany({
      where: {
        OR: [
          {
            status: MessageStatus.PENDING,
            nextAttemptAt: { lte: now },
          },
          {
            status: MessageStatus.PROCESSING,
            claimedAt: { lte: staleClaimBefore },
          },
        ],
      },
      select: { id: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: BATCH_SIZE,
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const claimed = await this.claim(candidate.id, now, staleClaimBefore);
      if (!claimed) {
        skipped++;
        continue;
      }

      if (claimed.channel !== MessageChannel.EMAIL) {
        await this.prisma.messageDelivery.update({
          where: { id: claimed.id },
          data: {
            status: MessageStatus.FAILED,
            claimedAt: null,
            lastError: `No delivery provider is configured for ${claimed.channel}`,
          },
        });
        failed++;
        continue;
      }

      try {
        await this.email.send(
          claimed.to,
          claimed.subject ?? 'School Management notification',
          claimed.body,
        );
        await this.prisma.messageDelivery.update({
          where: { id: claimed.id },
          data: {
            status: MessageStatus.SENT,
            sentAt: now,
            claimedAt: null,
            lastError: null,
          },
        });
        sent++;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        const permanentFailure = claimed.attempts >= MAX_ATTEMPTS;
        const delayMinutes = Math.min(
          60,
          2 ** Math.max(0, claimed.attempts - 1),
        );

        await this.prisma.messageDelivery.update({
          where: { id: claimed.id },
          data: {
            status: permanentFailure
              ? MessageStatus.FAILED
              : MessageStatus.PENDING,
            claimedAt: null,
            lastError: message.slice(0, 2000),
            ...(!permanentFailure
              ? {
                  nextAttemptAt: new Date(
                    now.getTime() + delayMinutes * 60 * 1000,
                  ),
                }
              : {}),
          },
        });
        this.logger.error(
          `Message delivery ${claimed.id} failed on attempt ${claimed.attempts}: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        failed++;
      }
    }

    return { considered: candidates.length, sent, failed, skipped };
  }

  private async claim(
    id: string,
    now: Date,
    staleClaimBefore: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.messageDelivery.updateMany({
        where: {
          id,
          OR: [
            {
              status: MessageStatus.PENDING,
              nextAttemptAt: { lte: now },
            },
            {
              status: MessageStatus.PROCESSING,
              claimedAt: { lte: staleClaimBefore },
            },
          ],
        },
        data: {
          status: MessageStatus.PROCESSING,
          claimedAt: now,
          attempts: { increment: 1 },
        },
      });

      if (result.count !== 1) return null;

      return tx.messageDelivery.findUniqueOrThrow({ where: { id } });
    });
  }
}
