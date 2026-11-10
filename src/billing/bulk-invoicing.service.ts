import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, InvoiceStatus } from '@prisma/client';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';
import { roundTo2 } from '../grading/grading.logic';

import { applyDiscounts, feeAppliesTo } from './billing.logic';
import { BatchInvoiceDto } from './dto/billing.dto';

const MAX_INVOICES = 5000;

interface PlannedInvoice {
  studentId: string;
  feeStructureId: string;
  amount: number;
  discountAmount: number;
  discountNote: string | null;
}

@Injectable()
export class BulkInvoicingService {
  constructor(private readonly prisma: PrismaService) {}

  private requireSchoolId(user: RequestUser): string {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    return user.schoolId;
  }

  // Works out who would be billed for what. Writes nothing.
  private async plan(dto: BatchInvoiceDto, schoolId: string) {
    if (dto.classId && dto.levelId) {
      throw new BadRequestException('Choose either a class or a level, not both');
    }

    const term = await this.prisma.term.findFirst({
      where: { id: dto.termId, academicSession: { schoolId } },
      select: { id: true, academicSessionId: true },
    });

    if (!term) {
      throw new NotFoundException('Term not found in this school');
    }

    const fees = await this.prisma.feeStructure.findMany({
      where: {
        schoolId,
        termId: term.id,
        ...(dto.feeStructureIds?.length ? { id: { in: dto.feeStructureIds } } : {}),
      },
    });

    if (fees.length === 0) {
      throw new ConflictException('There are no fee structures for this term');
    }

    if (dto.feeStructureIds?.length && fees.length !== new Set(dto.feeStructureIds).size) {
      throw new NotFoundException('One or more fee structures were not found for this term');
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        academicSessionId: term.academicSessionId,
        status: EnrollmentStatus.ACTIVE,
        class: {
          schoolId,
          ...(dto.classId ? { id: dto.classId } : {}),
          ...(dto.levelId ? { levelId: dto.levelId } : {}),
        },
      },
      select: { studentId: true, classId: true, class: { select: { levelId: true } } },
    });

    if (enrollments.length === 0) {
      throw new ConflictException('No enrolled students match this selection');
    }

    const studentIds = enrollments.map((e) => e.studentId);
    const feeIds = fees.map((fee) => fee.id);

    const existing = await this.prisma.invoice.findMany({
      where: {
        schoolId,
        termId: term.id,
        feeStructureId: { in: feeIds },
        studentId: { in: studentIds },
        status: { not: InvoiceStatus.CANCELLED },
      },
      select: { studentId: true, feeStructureId: true },
    });

    const alreadyBilled = new Set(existing.map((i) => `${i.studentId}|${i.feeStructureId}`));

    const discounts = await this.prisma.studentDiscount.findMany({
      where: {
        schoolId,
        isActive: true,
        studentId: { in: studentIds },
        OR: [{ termId: null }, { termId: term.id }],
      },
    });

    const rows: PlannedInvoice[] = [];
    let skippedExisting = 0;
    let fullyWaived = 0;

    for (const enrollment of enrollments) {
      for (const fee of fees) {
        if (!feeAppliesTo(fee, { classId: enrollment.classId, levelId: enrollment.class.levelId })) {
          continue;
        }

        if (alreadyBilled.has(`${enrollment.studentId}|${fee.id}`)) {
          skippedExisting++;
          continue;
        }

        const rules = discounts
          .filter((d) => d.studentId === enrollment.studentId && (!d.feeStructureId || d.feeStructureId === fee.id))
          .map((d) => ({ name: d.name, type: d.type, value: d.value }));

        const result = applyDiscounts(Number(fee.amount), rules);

        if (result.netAmount <= 0) {
          fullyWaived++;
          continue;
        }

        rows.push({
          studentId: enrollment.studentId,
          feeStructureId: fee.id,
          amount: result.netAmount,
          discountAmount: result.discountAmount,
          discountNote: result.applied.length
            ? result.applied.map((a) => `${a.name} (${a.amount})`).join('; ')
            : null,
        });
      }
    }

    if (rows.length > MAX_INVOICES) {
      throw new BadRequestException(
        `That would create ${rows.length} invoices. The limit is ${MAX_INVOICES} at a time, so choose a class or a level.`,
      );
    }

    const summary = {
      termId: term.id,
      students: new Set(rows.map((r) => r.studentId)).size,
      invoices: rows.length,
      skippedExisting,
      fullyWaived,
      totalBilled: roundTo2(rows.reduce((sum, r) => sum + r.amount, 0)),
      totalDiscounts: roundTo2(rows.reduce((sum, r) => sum + r.discountAmount, 0)),
    };

    return { rows, summary };
  }

  async preview(dto: BatchInvoiceDto, user: RequestUser) {
    const { summary } = await this.plan(dto, this.requireSchoolId(user));

    return { ...summary, willCreate: summary.invoices };
  }

  async create(dto: BatchInvoiceDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const { rows, summary } = await this.plan(dto, schoolId);

    if (rows.length === 0) {
      return { ...summary, created: 0 };
    }

    const year = new Date().getFullYear();
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;

    await this.prisma.$transaction(
      async (tx) => {
        await tx.invoice.createMany({
          data: rows.map((row) => ({
            schoolId,
            studentId: row.studentId,
            termId: summary.termId,
            feeStructureId: row.feeStructureId,
            invoiceNumber: `INV-${year}-${randomBytes(8).toString('hex').toUpperCase()}`,
            amount: row.amount,
            amountPaid: 0,
            status: InvoiceStatus.UNPAID,
            dueDate,
            discountAmount: row.discountAmount,
            discountNote: row.discountNote,
          })),
        });

        await tx.auditLog.create({
          data: {
            schoolId,
            userId: user.id,
            action: 'invoices.bulk_created',
            resource: 'Term',
            resourceId: summary.termId,
            metadata: { invoices: rows.length, totalBilled: summary.totalBilled },
          },
        });
      },
      { timeout: 60000 },
    );

    return { ...summary, created: rows.length };
  }
}
