import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, RefundStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreateRefundDto, UpdateRefundStatusDto } from './dto/billing.dto';
import { recalculateInvoice } from './invoice-totals';
import { PaystackRefundClient } from './paystack-refund.client';

// Full refunds only: the whole payment goes back and the invoice is recounted.
@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackRefundClient,
  ) {}

  private requireStaff(user: RequestUser): string {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    if (user.role !== UserRole.SCHOOL_ADMIN && user.role !== UserRole.ACCOUNTANT) {
      throw new ForbiddenException('Only school finance staff can manage refunds');
    }

    return user.schoolId;
  }

  async create(dto: CreateRefundDto, user: RequestUser) {
    const schoolId = this.requireStaff(user);
    const reason = dto.reason.trim();

    if (reason.length < 5) {
      throw new BadRequestException('Please give a reason of at least 5 characters');
    }

    const payment = await this.prisma.payment.findFirst({ where: { id: dto.paymentId, schoolId } });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== PaymentStatus.SUCCESSFUL) {
      throw new ConflictException(`Only successful payments can be refunded (this one is ${payment.status})`);
    }

    const open = await this.prisma.refund.count({
      where: { paymentId: payment.id, status: { in: [RefundStatus.PROCESSING, RefundStatus.COMPLETED] } },
    });

    if (open > 0) {
      throw new ConflictException('This payment already has a refund');
    }

    // Online payments: ask Paystack first. If it says no, nothing changes here.
    let providerReference: string | null = null;
    let status: RefundStatus = RefundStatus.COMPLETED;

    if (payment.provider === 'PAYSTACK') {
      const result = await this.paystack.refund({ transaction: payment.reference, reason });

      providerReference = result.id || null;
      status = result.status === 'processed' ? RefundStatus.COMPLETED : RefundStatus.PROCESSING;
    }

    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          schoolId,
          paymentId: payment.id,
          amount: payment.amount,
          reason,
          status,
          providerReference,
          createdById: user.id,
        },
      });

      await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUNDED } });

      if (payment.invoiceId) {
        await recalculateInvoice(tx, payment.invoiceId);
      }

      await tx.auditLog.create({
        data: {
          schoolId,
          userId: user.id,
          action: 'payment.refunded',
          resource: 'Payment',
          resourceId: payment.id,
          metadata: { refundId: refund.id, amount: Number(payment.amount), provider: payment.provider, status },
        },
      });

      return refund;
    });
  }

  // Paystack refunds finish later. This records how it ended.
  async updateStatus(id: string, dto: UpdateRefundStatusDto, user: RequestUser) {
    const schoolId = this.requireStaff(user);

    const refund = await this.prisma.refund.findFirst({ where: { id, schoolId } });

    if (!refund) {
      throw new NotFoundException('Refund not found');
    }

    if (refund.status !== RefundStatus.PROCESSING) {
      throw new ConflictException('Only a refund that is still processing can be updated');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.refund.update({
        where: { id },
        data: {
          status: dto.status,
          failureReason: dto.status === 'FAILED' ? dto.failureReason?.trim() || 'Refund failed' : null,
        },
      });

      // A failed refund means the customer was NOT paid back: the payment counts again
      if (dto.status === 'FAILED') {
        const payment = await tx.payment.findUnique({ where: { id: refund.paymentId } });

        if (payment && payment.status === PaymentStatus.REFUNDED) {
          await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.SUCCESSFUL } });

          if (payment.invoiceId) {
            await recalculateInvoice(tx, payment.invoiceId);
          }
        }
      }

      await tx.auditLog.create({
        data: {
          schoolId,
          userId: user.id,
          action: `refund.${dto.status.toLowerCase()}`,
          resource: 'Refund',
          resourceId: id,
        },
      });

      return updated;
    });
  }

  async findAll(user: RequestUser) {
    const schoolId = this.requireStaff(user);

    return this.prisma.refund.findMany({
      where: { schoolId },
      include: {
        payment: {
          select: {
            reference: true,
            provider: true,
            student: { select: { firstName: true, lastName: true, admissionNumber: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
