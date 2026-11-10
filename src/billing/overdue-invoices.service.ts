import { ForbiddenException, Injectable } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

import { startOfDayUtc } from './billing.logic';

@Injectable()
export class OverdueInvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  // Every unpaid or part-paid invoice whose due date has PASSED becomes OVERDUE.
  // An invoice due today is not overdue yet.
  // Leave schoolId out to do every school (what a nightly job will do).
  async markOverdue(options: { schoolId?: string; now?: Date } = {}) {
    const today = startOfDayUtc(options.now ?? new Date());

    const result = await this.prisma.invoice.updateMany({
      where: {
        ...(options.schoolId ? { schoolId: options.schoolId } : {}),
        status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID] },
        dueDate: { lt: today },
      },
      data: { status: InvoiceStatus.OVERDUE },
    });

    return { marked: result.count };
  }

  async markForMySchool(user: RequestUser) {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    return this.markOverdue({ schoolId: user.schoolId });
  }
}
