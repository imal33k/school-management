import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';
import { StudentAccessService } from '../student-access/student-access.service';

import { allocateInstallments, validateInstallmentPlan } from './billing.logic';
import { InstallmentPlanDto } from './dto/billing.dto';

const FINANCE_STAFF = [UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT];

@Injectable()
export class InstallmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StudentAccessService,
  ) {}

  private requireSchoolId(user: RequestUser): string {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    return user.schoolId;
  }

  private async getInvoice(invoiceId: string, schoolId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, schoolId } });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }

  async setPlan(invoiceId: string, dto: InstallmentPlanDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const invoice = await this.getInvoice(invoiceId, schoolId);

    if (invoice.status === InvoiceStatus.CANCELLED || invoice.status === InvoiceStatus.PAID) {
      throw new ConflictException('A payment plan cannot be set on a cancelled or fully paid invoice');
    }

    const items = dto.items.map((item) => ({ dueDate: new Date(item.dueDate), amount: item.amount }));
    const errors = validateInstallmentPlan(Number(invoice.amount), items);

    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Invalid payment plan', errors });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.invoiceInstallment.deleteMany({ where: { invoiceId } });
      await tx.invoiceInstallment.createMany({
        data: items.map((item, index) => ({
          invoiceId,
          number: index + 1,
          dueDate: item.dueDate,
          amount: item.amount,
        })),
      });
    });

    return this.getPlan(invoiceId, user);
  }

  async getPlan(invoiceId: string, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const invoice = await this.getInvoice(invoiceId, schoolId);

    await this.access.assertCanView(user, invoice.studentId, FINANCE_STAFF);

    const items = await this.prisma.invoiceInstallment.findMany({
      where: { invoiceId },
      orderBy: { number: 'asc' },
    });

    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: Number(invoice.amount),
        amountPaid: Number(invoice.amountPaid),
        status: invoice.status,
        dueDate: invoice.dueDate,
      },
      installments: allocateInstallments(
        items.map((item) => ({ number: item.number, dueDate: item.dueDate, amount: Number(item.amount) })),
        Number(invoice.amountPaid),
      ),
    };
  }

  async removePlan(invoiceId: string, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    await this.getInvoice(invoiceId, schoolId);
    await this.prisma.invoiceInstallment.deleteMany({ where: { invoiceId } });

    return { deleted: true };
  }
}
