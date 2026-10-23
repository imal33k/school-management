import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma, SubscriptionStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { UpdateSubscriptionStatusDto } from './dto/update-subscription-status.dto';
import { InitializeSubscriptionPaymentDto } from './dto/initialize-subscription-payment.dto';
import { PaystackService } from '../payments/paystack.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
  ) {}

  private async getSchoolId(user: RequestUser): Promise<string> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        userId: user.id,
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
    ];

    if (!allowedRoles.includes(user.role)) {
      throw new ForbiddenException(
        'You do not have permission to manage subscriptions',
      );
    }
  }

  private ensureSuperAdmin(user: RequestUser) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only super admins can perform this action');
    }
  }

  private validateDates(startDate: Date, endDate: Date) {
    if (endDate <= startDate) {
      throw new BadRequestException('End date must be after start date');
    }
  }

  async initializePayment(
    id: string,
    dto: InitializeSubscriptionPaymentDto,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: { plan: true, school: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      subscription.schoolId !== (await this.getSchoolId(user))
    )
      throw new ForbiddenException(
        'You do not have access to this subscription',
      );
    const selectedPlan = dto.planId
      ? await this.prisma.plan.findUnique({ where: { id: dto.planId } })
      : subscription.plan;
    if (!selectedPlan) throw new NotFoundException('Plan not found');
    if (!selectedPlan.isActive)
      throw new BadRequestException('The selected plan is inactive');
    const existingPending = await this.prisma.subscriptionPayment.findFirst({
      where: { subscriptionId: id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (existingPending) {
      const metadata = existingPending.metadata;
      if (
        metadata &&
        typeof metadata === 'object' &&
        !Array.isArray(metadata) &&
        'targetPlanId' in metadata &&
        metadata.targetPlanId !== selectedPlan.id
      ) {
        throw new ConflictException(
          'A payment for another plan is already pending',
        );
      }

      if (
        metadata &&
        typeof metadata === 'object' &&
        !Array.isArray(metadata) &&
        'authorizationUrl' in metadata &&
        typeof metadata.authorizationUrl === 'string' &&
        'accessCode' in metadata &&
        typeof metadata.accessCode === 'string'
      ) {
        return {
          payment: existingPending,
          authorizationUrl: metadata.authorizationUrl,
          accessCode: metadata.accessCode,
          reference: existingPending.reference,
        };
      }

      throw new ConflictException(
        'A subscription payment is being initialized; retry shortly',
      );
    }
    const reference = `SUB-${Date.now()}-${Math.random().toString(36).slice(-8).toUpperCase()}`;
    const amount = Number(selectedPlan.price);
    const payment = await this.prisma.subscriptionPayment.create({
      data: {
        schoolId: subscription.schoolId,
        subscriptionId: id,
        reference,
        amount: new Prisma.Decimal(amount),
        status: 'PENDING',
        metadata: {
          kind: 'subscription',
          subscriptionId: id,
          targetPlanId: selectedPlan.id,
        },
      },
    });
    try {
      const data = await this.paystack.initialize({
        email: subscription.school.email || user.email,
        amount,
        reference,
        callbackUrl: dto.callbackUrl,
        metadata: {
          kind: 'subscription',
          subscriptionPaymentId: payment.id,
          subscriptionId: id,
          schoolId: subscription.schoolId,
          targetPlanId: selectedPlan.id,
        },
      });
      const updatedPayment = await this.prisma.subscriptionPayment.update({
        where: { id: payment.id },
        data: {
          metadata: {
            kind: 'subscription',
            subscriptionId: id,
            targetPlanId: selectedPlan.id,
            authorizationUrl: data.authorization_url,
            accessCode: data.access_code,
          },
        },
      });
      return {
        payment: updatedPayment,
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
        reference: data.reference,
      };
    } catch (error) {
      await this.prisma.subscriptionPayment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }

  async create(dto: CreateSubscriptionDto, user: RequestUser) {
    this.ensureCanManage(user);

    let schoolId: string;

    if (user.role === UserRole.SUPER_ADMIN) {
      if (!dto.schoolId) {
        throw new BadRequestException(
          'schoolId is required when creating a subscription as a super admin',
        );
      }

      schoolId = dto.schoolId;
    } else {
      schoolId = await this.getSchoolId(user);
    }

    const school = await this.prisma.school.findUnique({
      where: {
        id: schoolId,
      },
    });

    if (!school) {
      throw new NotFoundException('School not found');
    }

    const plan = await this.prisma.plan.findUnique({
      where: {
        id: dto.planId,
      },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    if (!plan.isActive) {
      throw new BadRequestException('Cannot subscribe to an inactive plan');
    }

    const existing = await this.prisma.subscription.findUnique({
      where: {
        schoolId,
      },
    });

    if (existing) {
      throw new ConflictException('This school already has a subscription');
    }

    const now = new Date();
    let startDate = now;
    let endDate: Date;

    if (user.role === UserRole.SUPER_ADMIN) {
      startDate = dto.startDate ? new Date(dto.startDate) : now;
      endDate = dto.endDate
        ? new Date(dto.endDate)
        : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    } else {
      const trialDays = Number(process.env.TRIAL_PERIOD_DAYS ?? 14);
      if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 90) {
        throw new Error(
          'TRIAL_PERIOD_DAYS must be an integer between 1 and 90',
        );
      }
      endDate = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    }

    this.validateDates(startDate, endDate);

    return this.prisma.subscription.create({
      data: {
        schoolId,
        planId: dto.planId,
        status: SubscriptionStatus.TRIAL,
        startDate,
        endDate,
      },
      include: {
        school: true,
        plan: true,
      },
    });
  }

  async findAll(user: RequestUser) {
    this.ensureSuperAdmin(user);

    return this.prisma.subscription.findMany({
      include: {
        school: true,
        plan: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findMine(user: RequestUser) {
    this.ensureCanManage(user);

    const schoolId = await this.getSchoolId(user);

    const subscription = await this.prisma.subscription.findUnique({
      where: {
        schoolId,
      },
      include: {
        plan: true,
        school: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Your school does not have a subscription');
    }

    return subscription;
  }

  async findPaymentsForMine(user: RequestUser, query: PaginationQueryDto) {
    this.ensureCanManage(user);
    const schoolId = await this.getSchoolId(user);
    const subscription = await this.prisma.subscription.findUnique({
      where: { schoolId },
    });
    if (!subscription) {
      throw new NotFoundException('Your school does not have a subscription');
    }
    return this.listPayments(subscription.id, query);
  }

  async findPayments(id: string, user: RequestUser, query: PaginationQueryDto) {
    this.ensureCanManage(user);
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    if (user.role !== UserRole.SUPER_ADMIN) {
      const schoolId = await this.getSchoolId(user);
      if (subscription.schoolId !== schoolId) {
        throw new ForbiddenException(
          'You do not have access to this subscription',
        );
      }
    }
    return this.listPayments(id, query);
  }

  private async listPayments(
    subscriptionId: string,
    query: PaginationQueryDto,
  ) {
    const page = query.getPage();
    const limit = query.getLimit();
    const where = { subscriptionId };
    const [data, total] = await Promise.all([
      this.prisma.subscriptionPayment.findMany({
        where,
        select: {
          id: true,
          reference: true,
          amount: true,
          status: true,
          paidAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.subscriptionPayment.count({ where }),
    ]);
    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, user: RequestUser) {
    this.ensureCanManage(user);

    const subscription = await this.prisma.subscription.findUnique({
      where: {
        id,
      },
      include: {
        school: true,
        plan: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (user.role !== UserRole.SUPER_ADMIN) {
      const schoolId = await this.getSchoolId(user);

      if (subscription.schoolId !== schoolId) {
        throw new ForbiddenException(
          'You do not have access to this subscription',
        );
      }
    }

    return subscription;
  }

  async update(id: string, dto: UpdateSubscriptionDto, user: RequestUser) {
    this.ensureSuperAdmin(user);

    const subscription = await this.prisma.subscription.findUnique({
      where: {
        id,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (user.role !== UserRole.SUPER_ADMIN) {
      const schoolId = await this.getSchoolId(user);

      if (subscription.schoolId !== schoolId) {
        throw new ForbiddenException(
          'You do not have access to this subscription',
        );
      }
    }

    let planId = subscription.planId;

    if (dto.planId !== undefined) {
      const plan = await this.prisma.plan.findUnique({
        where: {
          id: dto.planId,
        },
      });

      if (!plan) {
        throw new NotFoundException('Plan not found');
      }

      if (!plan.isActive) {
        throw new BadRequestException('Cannot switch to an inactive plan');
      }

      planId = dto.planId;
    }

    const startDate =
      dto.startDate !== undefined
        ? new Date(dto.startDate)
        : subscription.startDate;

    const endDate =
      dto.endDate !== undefined ? new Date(dto.endDate) : subscription.endDate;

    this.validateDates(startDate, endDate);

    return this.prisma.subscription.update({
      where: {
        id,
      },
      data: {
        planId,
        startDate,
        endDate,
      },
      include: {
        school: true,
        plan: true,
      },
    });
  }

  async updateStatus(
    id: string,
    dto: UpdateSubscriptionStatusDto,
    user: RequestUser,
  ) {
    this.ensureSuperAdmin(user);

    const subscription = await this.prisma.subscription.findUnique({
      where: {
        id,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (
      subscription.status === SubscriptionStatus.CANCELLED &&
      dto.status !== SubscriptionStatus.CANCELLED
    ) {
      throw new ConflictException(
        'A cancelled subscription cannot be reactivated by changing its status',
      );
    }

    const data: Prisma.SubscriptionUpdateInput = {
      status: dto.status,
    };

    if (dto.status === SubscriptionStatus.CANCELLED) {
      data.cancelledAt = new Date();
    } else {
      data.cancelledAt = null;
    }

    return this.prisma.subscription.update({
      where: {
        id,
      },
      data,
      include: {
        school: true,
        plan: true,
      },
    });
  }

  async cancel(id: string, user: RequestUser) {
    this.ensureCanManage(user);

    const subscription = await this.prisma.subscription.findUnique({
      where: {
        id,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (user.role !== UserRole.SUPER_ADMIN) {
      const schoolId = await this.getSchoolId(user);

      if (subscription.schoolId !== schoolId) {
        throw new ForbiddenException(
          'You do not have access to this subscription',
        );
      }
    }

    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new ConflictException('Subscription is already cancelled');
    }

    return this.prisma.subscription.update({
      where: {
        id,
      },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancelledAt: new Date(),
      },
      include: {
        school: true,
        plan: true,
      },
    });
  }
}
