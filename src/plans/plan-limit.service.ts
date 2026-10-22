
import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlanLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureCanCreate(
    schoolId: string,
    kind: 'students' | 'teachers' | 'parents',
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { schoolId },
      include: { plan: true },
    });

    if (!subscription?.plan) return;

    if (!['TRIAL', 'ACTIVE'].includes(subscription.status)) {
      throw new ForbiddenException(
        'Your school subscription is not active',
      );
    }

    const limit =
      kind === 'students'
        ? subscription.plan.maxStudents
        : kind === 'teachers'
          ? subscription.plan.maxTeachers
          : subscription.plan.maxParents;

    if (limit == null) return;

    let count: number;

    if (kind === 'students') {
      count = await this.prisma.student.count({
        where: { schoolId },
      });
    } else if (kind === 'teachers') {
      count = await this.prisma.teacher.count({
        where: { schoolId },
      });
    } else {
      count = await this.prisma.parent.count({
        where: { schoolId },
      });
    }

    if (count >= limit) {
      throw new ForbiddenException(
        `Your ${subscription.plan.name} plan allows a maximum of ${limit} ${kind}`,
      );
    }
  }
}
