import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  Prisma,
  SubscriptionStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  RequestUser,
} from '../auth/decorator/current-user.decorator';

import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { UpdateSubscriptionStatusDto } from './dto/update-subscription-status.dto';
import { InitializeSubscriptionPaymentDto } from './dto/initialize-subscription-payment.dto';
import { PaystackService } from '../payments/paystack.service';

@Injectable()
export class SubscriptionsService {
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
    ];

    if (!allowedRoles.includes(user.role)) {
      throw new ForbiddenException(
        'You do not have permission to manage subscriptions',
      );
    }
  }

  private ensureSuperAdmin(
    user: RequestUser,
  ) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only super admins can perform this action',
      );
    }
  }

  private validateDates(
    startDate: Date,
    endDate: Date,
  ) {
    if (endDate <= startDate) {
      throw new BadRequestException(
        'End date must be after start date',
      );
    }
  }


  async initializePayment(id: string, dto: InitializeSubscriptionPaymentDto, user: RequestUser) {
    this.ensureCanManage(user);
    const subscription = await this.prisma.subscription.findUnique({ where: { id }, include: { plan: true, school: true } });
    if (!subscription) throw new NotFoundException('Subscription not found');
    if (user.role !== UserRole.SUPER_ADMIN && subscription.schoolId !== await this.getSchoolId(user)) throw new ForbiddenException('You do not have access to this subscription');
    if (!subscription.plan.isActive) throw new BadRequestException('The selected plan is inactive');
    const existingPending = await this.prisma.subscriptionPayment.findFirst({ where: { subscriptionId: id, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    if (existingPending) return { reference: existingPending.reference, message: 'A payment is already pending for this subscription' };
    const reference = `SUB-${Date.now()}-${Math.random().toString(36).slice(-8).toUpperCase()}`;
    const amount = Number(subscription.plan.price);
    const payment = await this.prisma.subscriptionPayment.create({ data: { schoolId: subscription.schoolId, subscriptionId: id, reference, amount: new Prisma.Decimal(amount), status: 'PENDING', metadata: { kind: 'subscription', subscriptionId: id } } });
    try {
      const data = await this.paystack.initialize({ email: subscription.school.email || user.email, amount, reference, callbackUrl: dto.callbackUrl, metadata: { kind: 'subscription', subscriptionPaymentId: payment.id, subscriptionId: id, schoolId: subscription.schoolId } });
      return { payment, authorizationUrl: data.authorization_url, accessCode: data.access_code, reference: data.reference };
    } catch (error) {
      await this.prisma.subscriptionPayment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      throw error;
    }
  }

  async create(
    dto: CreateSubscriptionDto,
    user: RequestUser,
  ) {
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
      schoolId =
        await this.getSchoolId(user);
    }

    const school =
      await this.prisma.school.findUnique({
        where: {
          id: schoolId,
        },
      });

    if (!school) {
      throw new NotFoundException(
        'School not found',
      );
    }

    const plan =
      await this.prisma.plan.findUnique({
        where: {
          id: dto.planId,
        },
      });

    if (!plan) {
      throw new NotFoundException(
        'Plan not found',
      );
    }

    if (!plan.isActive) {
      throw new BadRequestException(
        'Cannot subscribe to an inactive plan',
      );
    }

    const existing =
      await this.prisma.subscription.findUnique({
        where: {
          schoolId,
        },
      });

    if (existing) {
      throw new ConflictException(
        'This school already has a subscription',
      );
    }

    const startDate =
      new Date(dto.startDate);

    const endDate =
      new Date(dto.endDate);

    this.validateDates(
      startDate,
      endDate,
    );

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

  async findAll(
    user: RequestUser,
  ) {
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

  async findMine(
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const schoolId =
      await this.getSchoolId(user);

    const subscription =
      await this.prisma.subscription.findUnique({
        where: {
          schoolId,
        },
        include: {
          plan: true,
          school: true,
        },
      });

    if (!subscription) {
      throw new NotFoundException(
        'Your school does not have a subscription',
      );
    }

    return subscription;
  }

  async findOne(
    id: string,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const subscription =
      await this.prisma.subscription.findUnique({
        where: {
          id,
        },
        include: {
          school: true,
          plan: true,
        },
      });

    if (!subscription) {
      throw new NotFoundException(
        'Subscription not found',
      );
    }

    if (
      user.role !== UserRole.SUPER_ADMIN
    ) {
      const schoolId =
        await this.getSchoolId(user);

      if (
        subscription.schoolId !== schoolId
      ) {
        throw new ForbiddenException(
          'You do not have access to this subscription',
        );
      }
    }

    return subscription;
  }

  async update(
    id: string,
    dto: UpdateSubscriptionDto,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const subscription =
      await this.prisma.subscription.findUnique({
        where: {
          id,
        },
      });

    if (!subscription) {
      throw new NotFoundException(
        'Subscription not found',
      );
    }

    if (
      user.role !== UserRole.SUPER_ADMIN
    ) {
      const schoolId =
        await this.getSchoolId(user);

      if (
        subscription.schoolId !== schoolId
      ) {
        throw new ForbiddenException(
          'You do not have access to this subscription',
        );
      }
    }

    let planId =
      subscription.planId;

    if (dto.planId !== undefined) {
      const plan =
        await this.prisma.plan.findUnique({
          where: {
            id: dto.planId,
          },
        });

      if (!plan) {
        throw new NotFoundException(
          'Plan not found',
        );
      }

      if (!plan.isActive) {
        throw new BadRequestException(
          'Cannot switch to an inactive plan',
        );
      }

      planId = dto.planId;
    }

    const startDate =
      dto.startDate !== undefined
        ? new Date(dto.startDate)
        : subscription.startDate;

    const endDate =
      dto.endDate !== undefined
        ? new Date(dto.endDate)
        : subscription.endDate;

    this.validateDates(
      startDate,
      endDate,
    );

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

    const subscription =
      await this.prisma.subscription.findUnique({
        where: {
          id,
        },
      });

    if (!subscription) {
      throw new NotFoundException(
        'Subscription not found',
      );
    }

    if (
      subscription.status ===
        SubscriptionStatus.CANCELLED &&
      dto.status !==
        SubscriptionStatus.CANCELLED
    ) {
      throw new ConflictException(
        'A cancelled subscription cannot be reactivated by changing its status',
      );
    }

    const data: Prisma.SubscriptionUpdateInput = {
      status: dto.status,
    };

    if (
      dto.status ===
      SubscriptionStatus.CANCELLED
    ) {
      data.cancelledAt =
        new Date();
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

  async cancel(
    id: string,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const subscription =
      await this.prisma.subscription.findUnique({
        where: {
          id,
        },
      });

    if (!subscription) {
      throw new NotFoundException(
        'Subscription not found',
      );
    }

    if (
      user.role !== UserRole.SUPER_ADMIN
    ) {
      const schoolId =
        await this.getSchoolId(user);

      if (
        subscription.schoolId !== schoolId
      ) {
        throw new ForbiddenException(
          'You do not have access to this subscription',
        );
      }
    }

    if (
      subscription.status ===
      SubscriptionStatus.CANCELLED
    ) {
      throw new ConflictException(
        'Subscription is already cancelled',
      );
    }

    return this.prisma.subscription.update({
      where: {
        id,
      },
      data: {
        status:
          SubscriptionStatus.CANCELLED,
        cancelledAt: new Date(),
      },
      include: {
        school: true,
        plan: true,
      },
    });
  }
}