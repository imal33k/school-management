import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  Plan,
  SchoolStatus,
  StudentStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlanLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureCanCreate(
    schoolId: string,
    kind: 'students' | 'teachers' | 'parents',
  ) {
    const subscription = await this.ensureSubscriptionActive(schoolId);

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
        where: {
          schoolId,
          status: {
            notIn: [StudentStatus.GRADUATED, StudentStatus.TRANSFERRED],
          },
        },
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

  async ensurePlanCanAccommodate(schoolId: string, plan: Plan) {
    const [students, teachers, parents] = await Promise.all([
      this.prisma.student.count({
        where: {
          schoolId,
          status: {
            notIn: [StudentStatus.GRADUATED, StudentStatus.TRANSFERRED],
          },
        },
      }),
      this.prisma.teacher.count({ where: { schoolId } }),
      this.prisma.parent.count({ where: { schoolId } }),
    ]);

    const overLimits = [
      plan.maxStudents != null &&
      students > plan.maxStudents
        ? `${students} students (limit ${plan.maxStudents})`
        : null,
      plan.maxTeachers != null &&
      teachers > plan.maxTeachers
        ? `${teachers} teachers (limit ${plan.maxTeachers})`
        : null,
      plan.maxParents != null &&
      parents > plan.maxParents
        ? `${parents} parents (limit ${plan.maxParents})`
        : null,
    ].filter((item): item is string => item !== null);

    if (overLimits.length) {
      throw new ConflictException(
        `The selected ${plan.name} plan does not cover current usage: ${overLimits.join(', ')}`,
      );
    }
  }

  async ensureSubscriptionActive(schoolId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { schoolId },
      include: { plan: true, school: { select: { status: true } } },
    });

    if (!subscription) {
      throw new ForbiddenException('An active school subscription is required');
    }

    const now = new Date();
    const inPaidOrTrialStatus =
      subscription.status === SubscriptionStatus.TRIAL ||
      subscription.status === SubscriptionStatus.ACTIVE;
    if (
      subscription.school.status !== SchoolStatus.ACTIVE ||
      !inPaidOrTrialStatus ||
      subscription.startDate > now ||
      subscription.endDate <= now
    ) {
      if (inPaidOrTrialStatus && subscription.endDate <= now) {
        await this.prisma.subscription.updateMany({
          where: {
            id: subscription.id,
            status: subscription.status,
            endDate: { lte: now },
          },
          data: { status: SubscriptionStatus.EXPIRED },
        });
      }
      throw new ForbiddenException('Your school subscription is not active');
    }
    return subscription;
  }
}
