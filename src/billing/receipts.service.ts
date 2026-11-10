import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';
import { StudentAccessService } from '../student-access/student-access.service';

import { formatMoney, receiptNumber } from './billing.logic';
import { renderReceiptPdf } from './receipt-pdf';

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StudentAccessService,
  ) {}

  async getReceiptPdf(paymentId: string, user: RequestUser) {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    const schoolId = user.schoolId;

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, schoolId },
      include: {
        student: { select: { firstName: true, lastName: true, admissionNumber: true } },
        invoice: {
          select: {
            invoiceNumber: true,
            amount: true,
            amountPaid: true,
            feeStructure: { select: { name: true } },
            term: { select: { name: true } },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    await this.access.assertCanView(user, payment.studentId, [UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT]);

    if (payment.status !== PaymentStatus.SUCCESSFUL) {
      throw new ConflictException('Receipts are only issued for successful payments');
    }

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true, address: true, phone: true, email: true, currency: true },
    });

    const currency = school?.currency ?? 'NGN';
    const issuedAt = payment.paidAt ?? payment.createdAt;
    const invoice = payment.invoice;

    const description = invoice
      ? [invoice.feeStructure?.name ?? 'School fees', invoice.term?.name].filter(Boolean).join(' - ')
      : 'School fees';

    const buffer = await renderReceiptPdf({
      receiptNumber: receiptNumber(payment.id, issuedAt),
      issuedAt,
      school: school ?? { name: '', address: null, phone: null, email: null },
      student: {
        name: `${payment.student.firstName} ${payment.student.lastName}`,
        admissionNumber: payment.student.admissionNumber,
      },
      description,
      invoiceNumber: invoice?.invoiceNumber ?? null,
      method: payment.provider === 'PAYSTACK' ? 'Online (Paystack)' : 'Recorded by the school',
      reference: payment.reference,
      amountPaid: formatMoney(Number(payment.amount), currency),
      invoiceTotal: invoice ? formatMoney(Number(invoice.amount), currency) : null,
      totalPaidSoFar: invoice ? formatMoney(Number(invoice.amountPaid), currency) : null,
      balance: invoice
        ? formatMoney(Math.max(0, Number(invoice.amount) - Number(invoice.amountPaid)), currency)
        : null,
    });

    return { buffer, filename: `receipt-${receiptNumber(payment.id, issuedAt)}.pdf` };
  }
}
