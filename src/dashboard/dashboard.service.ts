import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import type { RequestUser } from '../auth/decorator/current-user.decorator';
import { UserRole } from '@prisma/client';
import { DashboardAggregateQueryDto } from './dto/dashboard-aggregate-query.dto';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}


  async getAggregates(user: RequestUser, query: DashboardAggregateQueryDto) {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        userId: user.id,
        ...(user.schoolId ? { schoolId: user.schoolId } : {}),
      },
    });
    if (!membership) throw new ForbiddenException('You do not belong to a school');
    const schoolId = membership.schoolId;

    const isFinanceStaff =
      user.role === UserRole.SCHOOL_ADMIN ||
      user.role === UserRole.SUPER_ADMIN ||
      user.role === UserRole.ACCOUNTANT;

    let teacherClassIds: string[] = [];
    if (user.role === UserRole.TEACHER) {
      const teacher = await this.prisma.teacher.findUnique({
        where: { userId: user.id },
        include: { classAssignments: { select: { classId: true } } },
      });
      if (!teacher) throw new ForbiddenException('Teacher profile not found');
      teacherClassIds = teacher.classAssignments.map(
        (assignment) => assignment.classId,
      );
    }

    let selfStudentIds: string[] = [];
    if (user.role === UserRole.STUDENT) {
      const student = await this.prisma.student.findFirst({
        where: { userId: user.id, schoolId },
        select: { id: true },
      });
      if (!student) throw new ForbiddenException('Student profile not found');
      selfStudentIds = [student.id];
    } else if (user.role === UserRole.PARENT) {
      const parent = await this.prisma.parent.findFirst({
        where: { userId: user.id, schoolId },
        include: { children: { select: { studentId: true } } },
      });
      if (!parent) throw new ForbiddenException('Parent profile not found');
      selfStudentIds = parent.children.map((child) => child.studentId);
    } else if (!isFinanceStaff && user.role !== UserRole.TEACHER) {
      throw new ForbiddenException('You are not allowed to view aggregates');
    }

    if (query.studentId) {
      if (
        (user.role === UserRole.STUDENT || user.role === UserRole.PARENT) &&
        !selfStudentIds.includes(query.studentId)
      ) {
        throw new ForbiddenException(
          'You can only view your own or linked students',
        );
      }

      const student = await this.prisma.student.findFirst({
        where: {
          id: query.studentId,
          schoolId,
          ...(user.role === UserRole.TEACHER
            ? {
                enrollments: {
                  some: {
                    classId: { in: teacherClassIds },
                    status: 'ACTIVE',
                  },
                },
              }
            : {}),
        },
      });
      if (!student) throw new ForbiddenException('Student is not in your school');
      const publishedOnly =
        user.role === UserRole.STUDENT || user.role === UserRole.PARENT;
      const [results, attendance] = await Promise.all([
        this.prisma.result.aggregate({
          where: {
            studentId: student.id,
            ...(publishedOnly
              ? { examination: { status: 'PUBLISHED' } }
              : {}),
            ...(user.role === UserRole.TEACHER
              ? {
                  examination: {
                    classId: { in: teacherClassIds },
                  },
                }
              : {}),
          },
          _avg: { totalScore: true },
          _count: { id: true },
        }),
        this.prisma.attendance.groupBy({
          by: ['status'],
          where: {
            studentId: student.id,
            ...(user.role === UserRole.TEACHER
              ? { classId: { in: teacherClassIds } }
              : {}),
          },
        }),
      ]);
      return { scope: 'student', studentId: student.id, results, attendance };
    }

    if (user.role === UserRole.STUDENT || user.role === UserRole.PARENT) {
      const students = await this.prisma.student.findMany({
        where: { id: { in: selfStudentIds }, schoolId },
        select: { id: true, firstName: true, lastName: true },
      });
      const aggregates = await Promise.all(
        students.map(async (student) => {
          const [results, attendance] = await Promise.all([
            this.prisma.result.aggregate({
              where: {
                studentId: student.id,
                examination: { status: 'PUBLISHED' },
              },
              _avg: { totalScore: true },
              _count: { id: true },
            }),
            this.prisma.attendance.groupBy({
              by: ['status'],
              where: { studentId: student.id },
            }),
          ]);
          return { studentId: student.id, results, attendance };
        }),
      );
      return {
        scope: user.role === UserRole.PARENT ? 'family' : 'student',
        students: aggregates,
      };
    }

    if (
      query.classId &&
      user.role === UserRole.TEACHER &&
      !teacherClassIds.includes(query.classId)
    ) {
      throw new ForbiddenException('You are not assigned to this class');
    }

    const classWhere: any = {
      schoolId,
      ...(user.role === UserRole.TEACHER
        ? {
            id: {
              in: query.classId ? [query.classId] : teacherClassIds,
            },
          }
        : query.classId
          ? { id: query.classId }
          : {}),
    };
    const classes = await this.prisma.schoolClass.findMany({ where: classWhere, select: { id: true, name: true } });
    const output = await Promise.all(classes.map(async cls => {
      const [results, attendance] = await Promise.all([
        this.prisma.result.aggregate({ where: { examination: { classId: cls.id } }, _avg: { totalScore: true }, _count: { id: true } }),
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
          ...(user.schoolId ? { schoolId: user.schoolId } : {}),
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

    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.ACCOUNTANT
    ) {
      const activeSession = await this.prisma.academicSession.findFirst({
        where: { schoolId, isActive: true },
        include: { terms: { where: { isActive: true } } },
      });
      let studentCount = 0;
      let classCount = 0;

      if (user.role === UserRole.TEACHER) {
        const teacher = await this.prisma.teacher.findUnique({
          where: { userId: user.id },
          include: { classAssignments: { select: { classId: true } } },
        });
        if (!teacher) throw new ForbiddenException('Teacher profile not found');
        const classIds = teacher.classAssignments.map(
          (assignment) => assignment.classId,
        );
        classCount = classIds.length;
        studentCount = await this.prisma.student.count({
          where: {
            schoolId,
            enrollments: {
              some: {
                classId: { in: classIds },
                status: 'ACTIVE',
              },
            },
          },
        });
      } else if (user.role === UserRole.STUDENT) {
        const student = await this.prisma.student.findFirst({
          where: { userId: user.id, schoolId },
          include: {
            enrollments: {
              where: { status: 'ACTIVE' },
              select: { classId: true },
            },
          },
        });
        if (!student) throw new ForbiddenException('Student profile not found');
        studentCount = 1;
        classCount = student.enrollments.length;
      } else if (user.role === UserRole.PARENT) {
        const parent = await this.prisma.parent.findFirst({
          where: { userId: user.id, schoolId },
          include: { children: { select: { studentId: true } } },
        });
        if (!parent) throw new ForbiddenException('Parent profile not found');
        studentCount = parent.children.length;
      } else {
        throw new ForbiddenException('You are not allowed to view this dashboard');
      }

      return {
        school: {
          id: membership.school.id,
          name: membership.school.name,
          logoUrl: membership.school.logoUrl,
        },
        statistics: {
          students: studentCount,
          classes: classCount,
        },
        academic: { activeSession },
      };
    }

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