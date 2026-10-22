import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { createHmac } from 'crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaystackService } from './paystack.service';
import { InitializePaymentDto } from './dto/initialize-payment.dto';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
  ) {}

  private async getSchoolId(
    user: RequestUser,
  ): Promise<string> {
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
        },
      });

    if (!membership) {
      throw new ForbiddenException(
        'You are not a member of any school',
      );
    }

    return membership.schoolId;
  }

  private ensureCanManage(
    user: RequestUser,
  ) {
    const allowedRoles: UserRole[] = [
      UserRole.SUPER_ADMIN,
      UserRole.SCHOOL_ADMIN,
      UserRole.ACCOUNTANT,
    ];

    if (!allowedRoles.includes(user.role)) {
      throw new ForbiddenException(
        'You do not have permission to manage payments',
      );
    }
  }

  private generateReference(): string {
    const timestamp = Date.now();
    const random = Math.random()
      .toString(36)
      .substring(2, 10)
      .toUpperCase();

    return `PAY-${timestamp}-${random}`;
  }


  async initializePaystack(dto: InitializePaymentDto, user: RequestUser) {
    const schoolId = await this.getSchoolId(user);
    const student = await this.prisma.student.findFirst({ where: { id: dto.studentId, schoolId } });
    if (!student) throw new NotFoundException('Student not found');
    let amount: number;
    let invoiceId = dto.invoiceId;
    if (invoiceId) {
      const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, schoolId, studentId: student.id } });
      if (!invoice) throw new NotFoundException('Invoice not found for this student');
      if (invoice.status === InvoiceStatus.CANCELLED || invoice.status === InvoiceStatus.PAID) throw new BadRequestException('This invoice cannot accept a payment');
      amount = Number(invoice.amount) - Number(invoice.amountPaid);
      if (amount <= 0) throw new BadRequestException('Invoice has no outstanding balance');
    } else {
      throw new BadRequestException('invoiceId is required for Paystack school payments');
    }
    const reference = this.generateReference();
    const payment = await this.prisma.payment.create({ data: { schoolId, studentId: student.id, invoiceId, reference, amount: new Prisma.Decimal(amount), status: PaymentStatus.PENDING, provider: 'PAYSTACK', metadata: { method: 'paystack' } } });
    try {
      const data = await this.paystack.initialize({ email: student.email || user.email, amount, reference, callbackUrl: dto.callbackUrl, metadata: { paymentId: payment.id, schoolId, studentId: student.id, invoiceId } });
      return { payment, authorizationUrl: data.authorization_url, accessCode: data.access_code, reference: data.reference };
    } catch (error) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
      throw error;
    }
  }

  async verifyPaystack(reference: string, user: RequestUser) {
    const schoolId = await this.getSchoolId(user);
    const payment = await this.prisma.payment.findFirst({ where: { reference, schoolId } });
    if (!payment) throw new NotFoundException('Payment not found');
    const data: any = await this.paystack.verify(reference);
    return this.applyPaystackPayment(data);
  }

  async handleWebhook(req: RawBodyRequest<Request>) {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.rawBody;
    if (!signature || !rawBody || !process.env.PAYSTACK_SECRET_KEY) throw new BadRequestException('Invalid Paystack webhook');
    const expected = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
    if (expected !== String(signature)) throw new ForbiddenException('Invalid Paystack signature');
    const event: any = req.body;
    if (event?.event === 'charge.success' && event.data?.reference) await this.applyPaystackPayment(event.data);
    return { received: true };
  }

  private async applyPaystackPayment(data: any) {
    const reference = data.reference;
    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) {
      const subscriptionPayment = await this.prisma.subscriptionPayment.findUnique({ where: { reference } });
      if (!subscriptionPayment) return { ignored: true };
      const successful = data.status === 'success' && data.gateway_response !== 'Declined';
      if (successful && Number(data.amount) / 100 + 0.001 < Number(subscriptionPayment.amount)) throw new BadRequestException('Paystack amount does not match subscription payment amount');
      return this.prisma.$transaction(async tx => {
        const updated = await tx.subscriptionPayment.update({ where: { id: subscriptionPayment.id }, data: { status: successful ? PaymentStatus.SUCCESSFUL : PaymentStatus.FAILED, paidAt: successful ? new Date() : undefined, metadata: data as Prisma.InputJsonValue } });
        if (successful) await tx.subscription.update({ where: { id: subscriptionPayment.subscriptionId }, data: { status: 'ACTIVE', startDate: new Date(), cancelledAt: null } });
        return updated;
      });
    }
    const successful = data.status === 'success' && data.gateway_response !== 'Declined';
    const status = successful ? PaymentStatus.SUCCESSFUL : PaymentStatus.FAILED;
    if (status === PaymentStatus.SUCCESSFUL && Number(data.amount) / 100 + 0.001 < Number(payment.amount)) throw new BadRequestException('Paystack amount does not match payment amount');
    return this.prisma.$transaction(async tx => {
      const updated = await tx.payment.update({ where: { id: payment.id }, data: { status, paidAt: successful ? new Date() : undefined, metadata: data as Prisma.InputJsonValue }, include: { student: true, invoice: true } });
      if (payment.invoiceId && successful) await this.updateInvoiceAfterPayment(tx, payment.invoiceId, PaymentStatus.SUCCESSFUL);
      return updated;
    });
  }

  async create(
    dto: CreatePaymentDto,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const schoolId =
      await this.getSchoolId(user);

    const student =
      await this.prisma.student.findFirst({
        where: {
          id: dto.studentId,
          schoolId,
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found',
      );
    }

    let invoice = null;

    if (dto.invoiceId) {
      invoice =
        await this.prisma.invoice.findFirst({
          where: {
            id: dto.invoiceId,
            schoolId,
            studentId: dto.studentId,
          },
        });

      if (!invoice) {
        throw new NotFoundException(
          'Invoice not found for this student',
        );
      }

      if (
        invoice.status === InvoiceStatus.CANCELLED
      ) {
        throw new BadRequestException(
          'Cannot make a payment against a cancelled invoice',
        );
      }

      const outstanding =
        Number(invoice.amount) -
        Number(invoice.amountPaid);

      if (dto.amount > outstanding) {
        throw new BadRequestException(
          `Payment amount cannot exceed the outstanding balance of ${outstanding}`,
        );
      }
    }

    const reference =
      this.generateReference();

    let metadata: Prisma.InputJsonValue | undefined;

    if (dto.metadata) {
      try {
        metadata =
          JSON.parse(dto.metadata);
      } catch {
        throw new BadRequestException(
          'metadata must contain valid JSON',
        );
      }
    }

    return this.prisma.payment.create({
      data: {
        schoolId,
        studentId: dto.studentId,
        invoiceId: dto.invoiceId,
        reference,
        amount: new Prisma.Decimal(
          dto.amount,
        ),
        status: PaymentStatus.PENDING,
        provider: 'INTERNAL',
        metadata,
      },
      include: {
        student: true,
        invoice: true,
      },
    });
  }

  async findAll(
    user: RequestUser, query: PaginationQueryDto = new PaginationQueryDto(),
  ) {
    const schoolId =
      await this.getSchoolId(user);

    const where: any = { schoolId, ...(query.search ? { reference: { contains: query.search, mode: 'insensitive' } } : {}) };
    const page = query.getPage(); const limit = query.getLimit();
    const result = await this.prisma.payment.findMany({ where,
      include: {
        student: true,
        invoice: true,
      },
      orderBy: { createdAt: 'desc' },
      ...(query.paginated ? { skip: (page - 1) * limit, take: limit } : {}),
    });
    if (!query.paginated) return result;
    const total = await this.prisma.payment.count({ where });
    return { data: result, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findByStudent(
    studentId: string,
    user: RequestUser,
  ) {
    const schoolId =
      await this.getSchoolId(user);

    const student =
      await this.prisma.student.findFirst({
        where: {
          id: studentId,
          schoolId,
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found',
      );
    }

    return this.prisma.payment.findMany({
      where: {
        schoolId,
        studentId,
      },
      include: {
        invoice: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findByInvoice(
    invoiceId: string,
    user: RequestUser,
  ) {
    const schoolId =
      await this.getSchoolId(user);

    const invoice =
      await this.prisma.invoice.findFirst({
        where: {
          id: invoiceId,
          schoolId,
        },
      });

    if (!invoice) {
      throw new NotFoundException(
        'Invoice not found',
      );
    }

    return this.prisma.payment.findMany({
      where: {
        schoolId,
        invoiceId,
      },
      include: {
        student: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(
    id: string,
    user: RequestUser,
  ) {
    const schoolId =
      await this.getSchoolId(user);

    const payment =
      await this.prisma.payment.findFirst({
        where: {
          id,
          schoolId,
        },
        include: {
          student: true,
          invoice: true,
        },
      });

    if (!payment) {
      throw new NotFoundException(
        'Payment not found',
      );
    }

    return payment;
  }

  async updateStatus(
    id: string,
    dto: UpdatePaymentStatusDto,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const schoolId =
      await this.getSchoolId(user);

    const payment =
      await this.prisma.payment.findFirst({
        where: {
          id,
          schoolId,
        },
      });

    if (!payment) {
      throw new NotFoundException(
        'Payment not found',
      );
    }

    if (
      payment.status ===
      PaymentStatus.SUCCESSFUL
    ) {
      if (
        dto.status ===
        PaymentStatus.PENDING
      ) {
        throw new ConflictException(
          'A successful payment cannot be changed back to pending',
        );
      }
    }

    if (
      payment.status ===
        PaymentStatus.REFUNDED &&
      dto.status !==
        PaymentStatus.REFUNDED
    ) {
      throw new ConflictException(
        'A refunded payment cannot be changed to another status',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const updatedPayment =
          await tx.payment.update({
            where: {
              id,
            },
            data: {
              status: dto.status,
              ...(dto.status ===
              PaymentStatus.SUCCESSFUL
                ? {
                    paidAt: new Date(),
                  }
                : {}),
            },
            include: {
              student: true,
              invoice: true,
            },
          });

        if (payment.invoiceId) {
          await this.updateInvoiceAfterPayment(
            tx,
            payment.invoiceId,
            dto.status,
          );
        }

        return updatedPayment;
      },
    );
  }

  private async updateInvoiceAfterPayment(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    paymentStatus: PaymentStatus,
  ) {
    const invoice =
      await tx.invoice.findUnique({
        where: {
          id: invoiceId,
        },
      });

    if (!invoice) {
      return;
    }

    const successfulPayments =
      await tx.payment.findMany({
        where: {
          invoiceId,
          status: PaymentStatus.SUCCESSFUL,
        },
      });

    const amountPaid =
      successfulPayments.reduce(
        (total, payment) =>
          total + Number(payment.amount),
        0,
      );

    let invoiceStatus: InvoiceStatus =
      InvoiceStatus.UNPAID;

    if (
      amountPaid >= Number(invoice.amount)
    ) {
      invoiceStatus =
        InvoiceStatus.PAID;
    } else if (amountPaid > 0) {
      invoiceStatus =
        InvoiceStatus.PARTIALLY_PAID;
    }

    if (
      invoice.status ===
      InvoiceStatus.CANCELLED
    ) {
      return;
    }

    await tx.invoice.update({
      where: {
        id: invoiceId,
      },
      data: {
        amountPaid: new Prisma.Decimal(
          amountPaid,
        ),
        status: invoiceStatus,
      },
    });
  }
}