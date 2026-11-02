import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InvoiceStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
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

  private async getSchoolId(user: RequestUser): Promise<string> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        userId: user.id,
        ...(user.schoolId ? { schoolId: user.schoolId } : {}),
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of any school');
    }

    return membership.schoolId;
  }

  private ensureCanManage(user: RequestUser) {
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

  private async ensureCanAccessStudent(
    user: RequestUser,
    studentId: string,
    schoolId: string,
  ) {
    if (
      user.role === UserRole.SCHOOL_ADMIN ||
      user.role === UserRole.ACCOUNTANT ||
      user.role === UserRole.SUPER_ADMIN
    ) {
      return;
    }

    if (user.role === UserRole.STUDENT) {
      const student = await this.prisma.student.findFirst({
        where: { id: studentId, userId: user.id, schoolId },
        select: { id: true },
      });
      if (student) return;
    }

    if (user.role === UserRole.PARENT) {
      const guardian = await this.prisma.studentGuardian.findFirst({
        where: {
          studentId,
          parent: { userId: user.id, schoolId },
        },
        select: { id: true },
      });
      if (guardian) return;
    }

    throw new ForbiddenException(
      'You are not allowed to access this student payment',
    );
  }

  private generateReference(): string {
    const timestamp = Date.now();
    const random = randomBytes(8).toString('hex').toUpperCase();

    return `PAY-${timestamp}-${random}`;
  }

  async initializePaystack(dto: InitializePaymentDto, user: RequestUser) {
    const schoolId = await this.getSchoolId(user);
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');
    await this.ensureCanAccessStudent(user, student.id, schoolId);
    const invoiceId = dto.invoiceId;
    if (!invoiceId) {
      throw new BadRequestException(
        'invoiceId is required for Paystack school payments',
      );
    }
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { paystackSubaccountCode: true },
    });
    if (!school?.paystackSubaccountCode) {
      throw new BadRequestException(
        'This school must configure its Paystack settlement account before accepting online payments',
      );
    }
    const reference = this.generateReference();
    let amount = 0;
    const payment = await this.prisma.$transaction(
      async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, schoolId, studentId: student.id },
        });
        if (!invoice) {
          throw new NotFoundException('Invoice not found for this student');
        }
        if (
          invoice.status === InvoiceStatus.CANCELLED ||
          invoice.status === InvoiceStatus.PAID
        ) {
          throw new BadRequestException(
            'This invoice cannot accept a payment',
          );
        }
        const reserved = await tx.payment.aggregate({
          where: {
            invoiceId,
            status: {
              in: [PaymentStatus.PENDING, PaymentStatus.SUCCESSFUL],
            },
          },
          _sum: { amount: true },
        });
        const outstanding = new Prisma.Decimal(invoice.amount).minus(
          reserved._sum.amount ?? 0,
        );
        if (outstanding.lte(0)) {
          throw new BadRequestException(
            'Invoice has no unreserved outstanding balance',
          );
        }
        amount = outstanding.toNumber();
        return tx.payment.create({
          data: {
            schoolId,
            studentId: student.id,
            invoiceId,
            reference,
            amount: outstanding,
            status: PaymentStatus.PENDING,
            provider: 'PAYSTACK',
            metadata: { method: 'paystack' },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    try {
      const data = await this.paystack.initialize({
        email: student.email || user.email,
        amount,
        reference,
        callbackUrl: dto.callbackUrl,
        subaccountCode: school.paystackSubaccountCode,
        metadata: {
          paymentId: payment.id,
          schoolId,
          studentId: student.id,
          invoiceId,
        },
      });
      return {
        payment,
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
        reference: data.reference,
      };
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });
      throw error;
    }
  }

  async verifyPaystack(reference: string, user: RequestUser) {
    const schoolId = await this.getSchoolId(user);
    const payment = await this.prisma.payment.findFirst({
      where: { reference, schoolId },
    });
    if (payment) {
      await this.ensureCanAccessStudent(user, payment.studentId, schoolId);
    } else {
      if (
        user.role !== UserRole.SCHOOL_ADMIN &&
        user.role !== UserRole.ACCOUNTANT &&
        user.role !== UserRole.SUPER_ADMIN
      ) {
        throw new NotFoundException('Payment not found');
      }
      const subscriptionPayment =
        await this.prisma.subscriptionPayment.findFirst({
          where: { reference, schoolId },
          select: { id: true },
        });
      if (!subscriptionPayment) {
        throw new NotFoundException('Payment not found');
      }
    }

    const data = await this.paystack.verify(reference);
    if (data.reference !== reference) {
      throw new BadGatewayException(
        'Paystack verification returned a different payment reference',
      );
    }
    return this.applyPaystackPayment(data);
  }

  async handleWebhook(req: RawBodyRequest<Request>) {
    const signatureHeader = req.headers['x-paystack-signature'];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;
    const rawBody = req.rawBody;
    if (!signature || !rawBody || !process.env.PAYSTACK_SECRET_KEY)
      throw new BadRequestException('Invalid Paystack webhook');
    const expected = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const signatureBuffer = Buffer.from(signature, 'hex');
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedBuffer)
    )
      throw new ForbiddenException('Invalid Paystack signature');
    const event: any = req.body;
    if (
      ['charge.success', 'charge.failed'].includes(event?.event) &&
      event.data?.reference
    )
      await this.applyPaystackPayment(event.data);
    return { received: true };
  }

  private async applyPaystackPayment(data: any) {
    const reference = data.reference;
    const payment = await this.prisma.payment.findUnique({
      where: { reference },
    });
    if (!payment) {
      const subscriptionPayment =
        await this.prisma.subscriptionPayment.findUnique({
          where: { reference },
        });
      if (!subscriptionPayment) return { ignored: true };
      const successful =
        data.status === 'success' && data.gateway_response !== 'Declined';
      const failed =
        data.status === 'failed' || data.gateway_response === 'Declined';
      if (!successful && !failed) return subscriptionPayment;
      if (
        successful &&
        !this.paystackAmountMatches(data.amount, subscriptionPayment.amount)
      )
        throw new BadRequestException(
          'Paystack amount does not match subscription payment amount',
        );
      return this.prisma.$transaction(async (tx) => {
        const changed = await tx.subscriptionPayment.updateMany({
          where: {
            id: subscriptionPayment.id,
            status: successful
              ? { in: [PaymentStatus.PENDING, PaymentStatus.FAILED] }
              : PaymentStatus.PENDING,
          },
          data: {
            status: successful
              ? PaymentStatus.SUCCESSFUL
              : PaymentStatus.FAILED,
            paidAt: successful ? new Date() : undefined,
            metadata: data as Prisma.InputJsonValue,
          },
        });
        if (!changed.count) {
          return tx.subscriptionPayment.findUniqueOrThrow({
            where: { id: subscriptionPayment.id },
          });
        }

        if (successful) {
          const subscription = await tx.subscription.findUniqueOrThrow({
            where: { id: subscriptionPayment.subscriptionId },
            include: { plan: true },
          });
          const metadata = subscriptionPayment.metadata;
          const targetPlanId =
            metadata &&
            typeof metadata === 'object' &&
            !Array.isArray(metadata) &&
            'targetPlanId' in metadata &&
            typeof metadata.targetPlanId === 'string'
              ? metadata.targetPlanId
              : subscription.planId;
          const targetPlan =
            targetPlanId === subscription.planId
              ? subscription.plan
              : await tx.plan.findUniqueOrThrow({
                  where: { id: targetPlanId },
                });
          const now = new Date();
          const periodStart =
            subscription.status === 'ACTIVE' && subscription.endDate > now
              ? subscription.endDate
              : now;
          const months =
            targetPlan.billingInterval === 'MONTHLY'
              ? 1
              : targetPlan.billingInterval === 'TERMLY'
                ? 3
                : 12;
          const periodEnd = this.addUtcMonths(periodStart, months);
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              planId: targetPlan.id,
              status: 'ACTIVE',
              startDate: periodStart,
              endDate: periodEnd,
              cancelledAt: null,
            },
          });
        }

        return tx.subscriptionPayment.findUniqueOrThrow({
          where: { id: subscriptionPayment.id },
        });
      });
    }
    const successful =
      data.status === 'success' && data.gateway_response !== 'Declined';
    const failed =
      data.status === 'failed' || data.gateway_response === 'Declined';
    if (!successful && !failed) return payment;
    const status = successful ? PaymentStatus.SUCCESSFUL : PaymentStatus.FAILED;
    if (
      status === PaymentStatus.SUCCESSFUL &&
      !this.paystackAmountMatches(data.amount, payment.amount)
    )
      throw new BadRequestException(
        'Paystack amount does not match payment amount',
      );
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: successful
            ? { in: [PaymentStatus.PENDING, PaymentStatus.FAILED] }
            : PaymentStatus.PENDING,
        },
        data: {
          status,
          paidAt: successful ? new Date() : undefined,
          metadata: data as Prisma.InputJsonValue,
        },
      });
      if (!changed.count) {
        return tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
          include: { student: true, invoice: true },
        });
      }
      if (payment.invoiceId && successful) {
        await this.updateInvoiceAfterPayment(tx, payment.invoiceId);
      }
      return tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { student: true, invoice: true },
      });
    });
  }

  private addUtcMonths(date: Date, months: number) {
    const result = new Date(date);
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + months);
    const finalDay = new Date(
      Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
    ).getUTCDate();
    result.setUTCDate(Math.min(day, finalDay));
    return result;
  }

  private paystackAmountMatches(
    providerAmount: unknown,
    paymentAmount: Prisma.Decimal,
  ): boolean {
    let amountInMinorUnits: Prisma.Decimal | undefined;
    if (
      typeof providerAmount === 'number' &&
      Number.isSafeInteger(providerAmount) &&
      providerAmount >= 0
    ) {
      amountInMinorUnits = new Prisma.Decimal(providerAmount);
    } else if (
      typeof providerAmount === 'string' &&
      /^\d+$/.test(providerAmount)
    ) {
      amountInMinorUnits = new Prisma.Decimal(providerAmount);
    }

    return (
      amountInMinorUnits?.equals(paymentAmount.mul(100)) ?? false
    );
  }

  async create(dto: CreatePaymentDto, user: RequestUser) {
    this.ensureCanManage(user);

    const schoolId = await this.getSchoolId(user);

    const student = await this.prisma.student.findFirst({
      where: {
        id: dto.studentId,
        schoolId,
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const reference = this.generateReference();

    let metadata: Prisma.InputJsonValue | undefined;

    if (dto.metadata) {
      try {
        metadata = JSON.parse(dto.metadata);
      } catch {
        throw new BadRequestException('metadata must contain valid JSON');
      }
    }

    return this.prisma.$transaction(
      async (tx) => {
        if (dto.invoiceId) {
          const invoice = await tx.invoice.findFirst({
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
          if (invoice.status === InvoiceStatus.CANCELLED) {
            throw new BadRequestException(
              'Cannot make a payment against a cancelled invoice',
            );
          }
          const reserved = await tx.payment.aggregate({
            where: {
              invoiceId: invoice.id,
              status: {
                in: [PaymentStatus.PENDING, PaymentStatus.SUCCESSFUL],
              },
            },
            _sum: { amount: true },
          });
          const outstanding = new Prisma.Decimal(invoice.amount).minus(
            reserved._sum.amount ?? 0,
          );
          if (new Prisma.Decimal(dto.amount).gt(outstanding)) {
            throw new BadRequestException(
              `Payment amount cannot exceed the unreserved balance of ${outstanding.toFixed(2)}`,
            );
          }
        }

        return tx.payment.create({
          data: {
            schoolId,
            studentId: dto.studentId,
            invoiceId: dto.invoiceId,
            reference,
            amount: new Prisma.Decimal(dto.amount),
            status: PaymentStatus.PENDING,
            provider: 'INTERNAL',
            metadata,
          },
          include: {
            student: true,
            invoice: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findAll(
    user: RequestUser,
    query: PaginationQueryDto = new PaginationQueryDto(),
  ) {
    this.ensureCanManage(user);
    const schoolId = await this.getSchoolId(user);

    const where: any = {
      schoolId,
      ...(query.search
        ? { reference: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const page = query.getPage();
    const limit = query.getLimit();
    const result = await this.prisma.payment.findMany({
      where,
      include: {
        student: true,
        invoice: true,
      },
      orderBy: { createdAt: 'desc' },
      ...(query.paginated ? { skip: (page - 1) * limit, take: limit } : {}),
    });
    if (!query.paginated) return result;
    const total = await this.prisma.payment.count({ where });
    return {
      data: result,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findByStudent(studentId: string, user: RequestUser) {
    this.ensureCanManage(user);
    const schoolId = await this.getSchoolId(user);

    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        schoolId,
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
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

  async findByInvoice(invoiceId: string, user: RequestUser) {
    this.ensureCanManage(user);
    const schoolId = await this.getSchoolId(user);

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        schoolId,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
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

  async findOne(id: string, user: RequestUser) {
    this.ensureCanManage(user);
    const schoolId = await this.getSchoolId(user);

    const payment = await this.prisma.payment.findFirst({
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
      throw new NotFoundException('Payment not found');
    }

    return payment;
  }

  async updateStatus(
    id: string,
    dto: UpdatePaymentStatusDto,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const schoolId = await this.getSchoolId(user);

    return this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.findFirst({
          where: { id, schoolId },
        });
        if (!payment) {
          throw new NotFoundException('Payment not found');
        }
        if (payment.status === dto.status) {
          return tx.payment.findUniqueOrThrow({
            where: { id },
            include: { student: true, invoice: true },
          });
        }

        const allowedTransition =
          (payment.status === PaymentStatus.PENDING &&
            (dto.status === PaymentStatus.SUCCESSFUL ||
              dto.status === PaymentStatus.FAILED)) ||
          (payment.status === PaymentStatus.FAILED &&
            dto.status === PaymentStatus.SUCCESSFUL) ||
          (payment.status === PaymentStatus.SUCCESSFUL &&
            dto.status === PaymentStatus.REFUNDED);
        if (!allowedTransition) {
          throw new ConflictException(
            `Payment cannot transition from ${payment.status} to ${dto.status}`,
          );
        }

        if (dto.status === PaymentStatus.SUCCESSFUL && payment.invoiceId) {
          const invoice = await tx.invoice.findUnique({
            where: { id: payment.invoiceId },
          });
          if (!invoice || invoice.status === InvoiceStatus.CANCELLED) {
            throw new ConflictException(
              'Payment cannot be settled against a missing or cancelled invoice',
            );
          }
          const otherReserved = await tx.payment.aggregate({
            where: {
              invoiceId: payment.invoiceId,
              id: { not: payment.id },
              status: {
                in: [PaymentStatus.PENDING, PaymentStatus.SUCCESSFUL],
              },
            },
            _sum: { amount: true },
          });
          const totalReserved = new Prisma.Decimal(
            otherReserved._sum.amount ?? 0,
          ).plus(payment.amount);
          if (totalReserved.gt(invoice.amount)) {
            throw new ConflictException(
              'Settling this payment would exceed the invoice balance',
            );
          }
        }

        const updatedPayment = await tx.payment.update({
          where: { id },
          data: {
            status: dto.status,
            ...(dto.status === PaymentStatus.SUCCESSFUL
              ? { paidAt: new Date() }
              : {}),
          },
          include: { student: true, invoice: true },
        });

        if (payment.invoiceId) {
          await this.updateInvoiceAfterPayment(tx, payment.invoiceId);
        }

        return updatedPayment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async updateInvoiceAfterPayment(
    tx: Prisma.TransactionClient,
    invoiceId: string,
  ) {
    const invoice = await tx.invoice.findUnique({
      where: {
        id: invoiceId,
      },
    });

    if (!invoice) {
      return;
    }

    const successfulPayments = await tx.payment.findMany({
      where: {
        invoiceId,
        status: PaymentStatus.SUCCESSFUL,
      },
    });

    const amountPaid = successfulPayments.reduce(
      (total, payment) => total.plus(payment.amount),
      new Prisma.Decimal(0),
    );

    let invoiceStatus: InvoiceStatus = InvoiceStatus.UNPAID;

    if (amountPaid.greaterThanOrEqualTo(invoice.amount)) {
      invoiceStatus = InvoiceStatus.PAID;
    } else if (amountPaid.greaterThan(0)) {
      invoiceStatus = InvoiceStatus.PARTIALLY_PAID;
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      return;
    }

    await tx.invoice.update({
      where: {
        id: invoiceId,
      },
      data: {
        amountPaid: new Prisma.Decimal(amountPaid),
        status: invoiceStatus,
      },
    });
  }
}
