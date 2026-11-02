import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import {
  InvoiceStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomBytes } from 'crypto';

import type { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // =========================
  // CREATE
  // =========================

  async create(
    user: RequestUser,
    dto: CreateInvoiceDto,
  ) {
    await this.checkAdmin(user);

    const membership =
      await this.getAdminMembership(user);

    // Verify student belongs to this school
    const student =
      await this.prisma.student.findFirst({
        where: {
          id: dto.studentId,
          schoolId: membership.schoolId,
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found in your school',
      );
    }

    // Verify term belongs to this school
    const term = await this.prisma.term.findFirst({
      where: {
        id: dto.termId,
        academicSession: {
          schoolId: membership.schoolId,
        },
      },
    });

    if (!term) {
      throw new NotFoundException(
        'Term not found in your school',
      );
    }

    let amount: number;
    let feeStructureId: string | undefined;

    // =========================
    // FEE STRUCTURE
    // =========================

    if (dto.feeStructureId) {
      const feeStructure =
        await this.prisma.feeStructure.findFirst({
          where: {
            id: dto.feeStructureId,
            schoolId: membership.schoolId,
            termId: dto.termId,
          },
        });

      if (!feeStructure) {
        throw new NotFoundException(
          'Fee structure not found for this term',
        );
      }

      amount = Number(feeStructure.amount);
      feeStructureId = feeStructure.id;
    }

    // =========================
    // CUSTOM AMOUNT
    // =========================

    else {
      if (dto.amount === undefined) {
        throw new BadRequestException(
          'Either feeStructureId or amount must be provided',
        );
      }

      if (dto.amount <= 0) {
        throw new BadRequestException(
          'Invoice amount must be greater than 0',
        );
      }

      amount = dto.amount;
    }

    // =========================
    // GENERATE INVOICE NUMBER
    // =========================

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.invoice.create({
          data: {
            schoolId: membership.schoolId,
            studentId: student.id,
            termId: term.id,
            feeStructureId,
            invoiceNumber: this.generateInvoiceNumber(),
            amount,
            amountPaid: 0,
            status: InvoiceStatus.UNPAID,
            dueDate: dto.dueDate
              ? new Date(dto.dueDate)
              : undefined,
          },
          include: {
            student: true,
            term: true,
            feeStructure: true,
            payments: true,
          },
        });
      } catch (error) {
        if (!this.isInvoiceNumberCollision(error)) {
          throw error;
        }
      }
    }

    throw new ConflictException(
      'Unable to allocate a unique invoice number; please retry',
    );
  }


  async findMine(user: RequestUser) {
    if (user.role !== UserRole.STUDENT && user.role !== UserRole.PARENT) throw new ForbiddenException('Only students and parents can use this endpoint');
    if (user.role === UserRole.STUDENT) {
      const student = await this.prisma.student.findFirst({ where: { userId: user.id } });
      if (!student) throw new NotFoundException('Student profile not found');
      return this.prisma.invoice.findMany({ where: { studentId: student.id }, include: { term: true, feeStructure: true, payments: true }, orderBy: { createdAt: 'desc' } });
    }
    const parent = await this.prisma.parent.findFirst({ where: { userId: user.id } });
    if (!parent) throw new NotFoundException('Parent profile not found');
    return this.prisma.invoice.findMany({ where: { student: { guardians: { some: { parentId: parent.id } } } }, include: { student: true, term: true, feeStructure: true, payments: true }, orderBy: { createdAt: 'desc' } });
  }

  // =========================
  // FIND ALL
  // =========================

  async findAll(user: RequestUser, query: PaginationQueryDto = new PaginationQueryDto()) {
    const membership = await this.getFinancialStaffMembership(user);

    const where: any = { schoolId: membership.schoolId, ...(query.search ? { OR: [{ invoiceNumber: { contains: query.search, mode: 'insensitive' } }, { student: { firstName: { contains: query.search, mode: 'insensitive' } } }, { student: { lastName: { contains: query.search, mode: 'insensitive' } } }] } : {}) };
    const page = query.getPage(); const limit = query.getLimit();
    const result = await this.prisma.invoice.findMany({ where,
      include: {
        student: true,
        term: true,
        feeStructure: true,
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      ...(query.paginated ? { skip: (page - 1) * limit, take: limit } : {}),
    });
    if (!query.paginated) return result;
    const total = await this.prisma.invoice.count({ where });
    return { data: result, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // =========================
  // FIND ONE
  // =========================

  async findOne(
    user: RequestUser,
    id: string,
  ) {
    const membership = await this.getFinancialStaffMembership(user);

    const invoice =
      await this.prisma.invoice.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
        include: {
          student: true,
          term: true,
          feeStructure: true,
          payments: {
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      });

    if (!invoice) {
      throw new NotFoundException(
        'Invoice not found',
      );
    }

    return invoice;
  }

  // =========================
  // UPDATE
  // =========================

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateInvoiceDto,
  ) {
    await this.checkAdmin(user);

    const membership =
      await this.getAdminMembership(user);

    const invoice =
      await this.prisma.invoice.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!invoice) {
      throw new NotFoundException(
        'Invoice not found',
      );
    }

    // Don't modify invoices that are already paid
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException(
        'A paid invoice cannot be modified',
      );
    }

    return this.prisma.invoice.update({
      where: {
        id: invoice.id,
      },
      data: {
        ...(dto.dueDate !== undefined && {
          dueDate: new Date(dto.dueDate),
        }),
      },
      include: {
        student: true,
        term: true,
        feeStructure: true,
        payments: true,
      },
    });
  }

  // =========================
  // DELETE
  // =========================

  async remove(
    user: RequestUser,
    id: string,
  ) {
    await this.checkAdmin(user);

    const membership =
      await this.getAdminMembership(user);

    const invoice =
      await this.prisma.invoice.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
        include: {
          payments: true,
        },
      });

    if (!invoice) {
      throw new NotFoundException(
        'Invoice not found',
      );
    }

    if (invoice.amountPaid.greaterThan(0)) {
      throw new BadRequestException(
        'An invoice with payments cannot be deleted',
      );
    }

    if (invoice.payments.length > 0) {
      throw new BadRequestException(
        'An invoice with payment records cannot be deleted',
      );
    }

    await this.prisma.invoice.delete({
      where: {
        id: invoice.id,
      },
    });

    return {
      message: 'Invoice deleted successfully',
    };
  }

  async cancel(user: RequestUser, id: string) {
    await this.checkAdmin(user);
    const membership = await this.getAdminMembership(user);

    return this.prisma.$transaction(
      async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { id, schoolId: membership.schoolId },
        });
        if (!invoice) {
          throw new NotFoundException('Invoice not found');
        }
        if (invoice.status === InvoiceStatus.CANCELLED) {
          return invoice;
        }
        if (invoice.status === InvoiceStatus.PAID) {
          throw new ConflictException('A paid invoice cannot be cancelled');
        }
        const activePayment = await tx.payment.findFirst({
          where: {
            invoiceId: invoice.id,
            status: { in: ['PENDING', 'SUCCESSFUL'] },
          },
          select: { id: true },
        });
        if (activePayment) {
          throw new ConflictException(
            'An invoice with pending or successful payments cannot be cancelled',
          );
        }
        return tx.invoice.update({
          where: { id: invoice.id },
          data: { status: InvoiceStatus.CANCELLED },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  // =========================
  // GENERATE INVOICE NUMBER
  // =========================

  private generateInvoiceNumber(): string {
    const year = new Date().getFullYear();
    return `INV-${year}-${randomBytes(8).toString('hex').toUpperCase()}`;
  }

  private isInvoiceNumberCollision(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;
    const fields = Array.isArray(target)
      ? target.map(String)
      : [String(target ?? '')];
    return fields.some((field) => field.includes('invoiceNumber'));
  }

  // =========================
  // CHECK ADMIN
  // =========================

  private async checkAdmin(
    user: RequestUser,
  ) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN
    ) {
      throw new ForbiddenException(
        'Only school administrators can manage invoices',
      );
    }
  }

  // =========================
  // GET ADMIN MEMBERSHIP
  // =========================

  private async getAdminMembership(
    user: RequestUser,
  ) {
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          role: UserRole.SCHOOL_ADMIN,
        },
      });

    if (!membership) {
      throw new ForbiddenException(
        'You are not a school administrator',
      );
    }

    return membership;
  }

  private async getFinancialStaffMembership(user: RequestUser) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.ACCOUNTANT &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only school administrators and accountants can view all invoices',
      );
    }

    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        userId: user.id,
        ...(user.schoolId ? { schoolId: user.schoolId } : {}),
        role: {
          in: [UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN],
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        'You are not financial staff for the active school',
      );
    }

    return membership;
  }
}