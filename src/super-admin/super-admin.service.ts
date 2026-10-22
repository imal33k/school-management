import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import {
  SchoolStatus,
  SubscriptionStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private ensureSuperAdmin(
    user: RequestUser,
  ) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only super admins can access this resource',
      );
    }
  }

  async getDashboard(
    user: RequestUser,
  ) {
    this.ensureSuperAdmin(user);

    const [
      totalSchools,
      activeSchools,
      inactiveSchools,
      suspendedSchools,
      totalUsers,
      totalStudents,
      totalTeachers,
      totalParents,
      totalSubscriptions,
      activeSubscriptions,
      trialSubscriptions,
      pastDueSubscriptions,
      cancelledSubscriptions,
      expiredSubscriptions,
    ] = await Promise.all([
      this.prisma.school.count(),

      this.prisma.school.count({
        where: {
          status: SchoolStatus.ACTIVE,
        },
      }),

      this.prisma.school.count({
        where: {
          status: SchoolStatus.INACTIVE,
        },
      }),

      this.prisma.school.count({
        where: {
          status: SchoolStatus.SUSPENDED,
        },
      }),

      this.prisma.user.count(),

      this.prisma.student.count(),

      this.prisma.teacher.count(),

      this.prisma.parent.count(),

      this.prisma.subscription.count(),

      this.prisma.subscription.count({
        where: {
          status:
            SubscriptionStatus.ACTIVE,
        },
      }),

      this.prisma.subscription.count({
        where: {
          status:
            SubscriptionStatus.TRIAL,
        },
      }),

      this.prisma.subscription.count({
        where: {
          status:
            SubscriptionStatus.PAST_DUE,
        },
      }),

      this.prisma.subscription.count({
        where: {
          status:
            SubscriptionStatus.CANCELLED,
        },
      }),

      this.prisma.subscription.count({
        where: {
          status:
            SubscriptionStatus.EXPIRED,
        },
      }),
    ]);

    return {
      schools: {
        total: totalSchools,
        active: activeSchools,
        inactive: inactiveSchools,
        suspended: suspendedSchools,
      },

      users: {
        total: totalUsers,
      },

      students: {
        total: totalStudents,
      },

      teachers: {
        total: totalTeachers,
      },

      parents: {
        total: totalParents,
      },

      subscriptions: {
        total: totalSubscriptions,
        active: activeSubscriptions,
        trial: trialSubscriptions,
        pastDue: pastDueSubscriptions,
        cancelled: cancelledSubscriptions,
        expired: expiredSubscriptions,
      },
    };
  }
}