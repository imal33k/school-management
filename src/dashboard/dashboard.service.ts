import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import type { RequestUser } from '../auth/decorator/current-user.decorator';
import { DashboardAggregateQueryDto } from './dto/dashboard-aggregate-query.dto';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}


  async getAggregates(user: RequestUser, query: DashboardAggregateQueryDto) {
    const membership = await this.prisma.schoolMembership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new ForbiddenException('You do not belong to a school');
    const schoolId = membership.schoolId;
    if (query.studentId) {
      const student = await this.prisma.student.findFirst({ where: { id: query.studentId, schoolId } });
      if (!student) throw new ForbiddenException('Student is not in your school');
      const [results, attendance] = await Promise.all([
        this.prisma.result.aggregate({ where: { studentId: student.id }, _avg: { totalScore: true }, _count: { id: true } }),
        this.prisma.attendance.groupBy({ by: ['status'], where: { studentId: student.id } }),
      ]);
      return { scope: 'student', studentId: student.id, results, attendance };
    }
    const classWhere: any = { schoolId, ...(query.classId ? { id: query.classId } : {}) };
    const classes = await this.prisma.schoolClass.findMany({ where: classWhere, select: { id: true, name: true } });
    const output = await Promise.all(classes.map(async cls => {
      const [results, attendance] = await Promise.all([
        this.prisma.result.aggregate({ where: { student: { enrollments: { some: { classId: cls.id } } } }, _avg: { totalScore: true }, _count: { id: true } }),
        this.prisma.attendance.groupBy({ by: ['status'], where: { classId: cls.id } }),
      ]);
      return { classId: cls.id, className: cls.name, results, attendance };
    }));
    return { scope: query.classId ? 'class' : 'school', classes: output };
  }

  async getDashboard(
    user: RequestUser,
  ) {
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
        },
        include: {
          school: true,
        },
      });

    if (!membership) {
      throw new ForbiddenException(
        'You do not belong to a school',
      );
    }

    const schoolId = membership.schoolId;

    const [
      studentCount,
      teacherCount,
      parentCount,
      classCount,
      subjectCount,
      activeSession,
      pendingInvoices,
      paidInvoices,
      revenue,
      failedPayments,
      recentAnnouncements,
    ] = await Promise.all([
      this.prisma.student.count({
        where: {
          schoolId,
        },
      }),

      this.prisma.teacher.count({
        where: {
          schoolId,
        },
      }),

      this.prisma.parent.count({
        where: {
          schoolId,
        },
      }),

      this.prisma.schoolClass.count({
        where: {
          schoolId,
        },
      }),

      this.prisma.subject.count({
        where: {
          schoolId,
        },
      }),

      this.prisma.academicSession.findFirst({
        where: {
          schoolId,
          isActive: true,
        },
        include: {
          terms: {
            where: {
              isActive: true,
            },
          },
        },
      }),

      this.prisma.invoice.count({
        where: {
          schoolId,
          status: {
            in: [
              'UNPAID',
              'PARTIALLY_PAID',
              'OVERDUE',
            ],
          },
        },
      }),

      this.prisma.invoice.count({
        where: {
          schoolId,
          status: 'PAID',
        },
      }),

      this.prisma.payment.aggregate({ where: { schoolId, status: 'SUCCESSFUL' }, _sum: { amount: true } }),

      this.prisma.payment.count({ where: { schoolId, status: 'FAILED' } }),

      this.prisma.announcement.findMany({
        where: {
          schoolId,
          published: true,
        },
        orderBy: {
          publishedAt: 'desc',
        },
        take: 5,
      }),
    ]);

    return {
      school: {
        id: membership.school.id,
        name: membership.school.name,
        logoUrl: membership.school.logoUrl,
      },

      statistics: {
        students: studentCount,
        teachers: teacherCount,
        parents: parentCount,
        classes: classCount,
        subjects: subjectCount,
      },

      academic: {
        activeSession,
      },

      finance: {
        pendingInvoices,
        paidInvoices,
        revenue: Number(revenue._sum.amount ?? 0),
        failedPayments,
      },

      recentAnnouncements,
    };
  }
}