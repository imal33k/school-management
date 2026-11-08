import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import {
  RequestUser,
} from '../auth/decorator/current-user.decorator';

import { UserRole, UserStatus } from '@prisma/client';

import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';
import { AssignTeacherSubjectDto } from './dto/assign-teacher-subject.dto';

import * as bcrypt from 'bcrypt';
import { PlanLimitService } from '../plans/plan-limit.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EmailService } from '../common/email.service';
import { randomBytes } from 'crypto';

@Injectable()
export class TeacherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitService,
    private readonly auditLog: AuditLogService,
    private readonly email: EmailService,
  ) {}

  private ensureAdmin(user: RequestUser) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only school administrators can manage teachers',
      );
    }
  }

  private ensureSelfOrAdmin(user: RequestUser, teacherUserId: string) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN &&
      user.id !== teacherUserId
    ) {
      throw new ForbiddenException(
        'You do not have permission to access this teacher',
      );
    }

    return teacherUserId;
  }

  private areTeacherEmailsPaused() {
    return process.env.PAUSE_TEACHER_EMAILS === 'true';
  }

  private async getMembership(user: RequestUser) {
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          ...(user.schoolId ? { schoolId: user.schoolId } : {}),
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'You are not a member of any school',
      );
    }

    return membership;
  }

  async create(
    user: RequestUser,
    dto: CreateTeacherDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    await this.planLimits.ensureCanCreate(membership.schoolId, 'teachers');

    const existingTeacher =
      await this.prisma.teacher.findFirst({
        where: {
          schoolId: membership.schoolId,
          employeeId: dto.employeeId,
        },
      });

    if (existingTeacher) {
      throw new ConflictException(
        'A teacher with this employee ID already exists in this school',
      );
    }

    const existingUser = await this.prisma.user.findUnique({
      where: {
        email: dto.email,
      },
    });

    if (existingUser) {
      throw new ConflictException(
        'A user with this email already exists',
      );
    }

    const emailsPaused = this.areTeacherEmailsPaused();
    if (!emailsPaused) this.email.assertConfigured();
    const temporaryPassword = randomBytes(24).toString('hex');
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    const teacher = await this.prisma.$transaction(async (tx) => {
      const teacherUser = await tx.user.create({
        data: {
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          password: hashedPassword,
          role: UserRole.TEACHER,
          mustChangePassword: true,
          emailVerifiedAt: new Date(),
        },
      });

      await tx.schoolMembership.create({
        data: {
          userId: teacherUser.id,
          schoolId: membership.schoolId,
          role: UserRole.TEACHER,
        },
      });

      const createdTeacher = await tx.teacher.create({
        data: {
          schoolId: membership.schoolId,
          userId: teacherUser.id,
          employeeId: dto.employeeId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          address: dto.address,
          photoUrl: dto.photoUrl,
        },
      });

      return createdTeacher;
    });

    if (!emailsPaused) {
      try {
        await this.email.send(
          dto.email,
          'Your teacher account is ready',
          `Your temporary password is: ${temporaryPassword}. Sign in and change it before accessing school features.`,
        );
      } catch (error) {
        await this.prisma.user.delete({
          where: { id: teacher.userId },
        });
        throw error;
      }
    }

    await this.auditLog.create({
      schoolId: membership.schoolId,
      userId: user.id,
      action: 'teacher.created',
      resource: 'Teacher',
      resourceId: teacher.id,
      metadata: {
        teacherId: teacher.id,
        employeeId: dto.employeeId,
        createdBy: user.id,
      },
    });

    return {
      teacher,
      ...(emailsPaused ? { temporaryPassword, emailSent: false } : {}),
    };
  }

  async resetPassword(user: RequestUser, id: string) {
    this.ensureAdmin(user);
    const membership = await this.getMembership(user);
    const teacher = await this.prisma.teacher.findFirst({
      where: { id, schoolId: membership.schoolId },
      include: { user: true },
    });

    if (!teacher) {
      throw new NotFoundException('Teacher not found');
    }

    const emailsPaused = this.areTeacherEmailsPaused();
    if (!emailsPaused) this.email.assertConfigured();
    const temporaryPassword = randomBytes(24).toString('hex');
    const temporaryPasswordHash = await bcrypt.hash(temporaryPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: teacher.userId },
        data: {
          password: temporaryPasswordHash,
          mustChangePassword: true,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: teacher.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    if (!emailsPaused) {
      try {
        await this.email.send(
          teacher.user.email,
          'Your teacher password was reset',
          `Your temporary password is: ${temporaryPassword}. Sign in and change it before accessing school features.`,
        );
      } catch (emailError) {
        try {
          await this.prisma.user.update({
            where: { id: teacher.userId },
            data: {
              password: teacher.user.password,
              mustChangePassword: teacher.user.mustChangePassword,
            },
          });
        } catch (rollbackError) {
          throw new AggregateError(
            [emailError, rollbackError],
            'Teacher password email failed and the previous password could not be restored',
          );
        }
        throw emailError;
      }
    }

    await this.auditLog.create({
      schoolId: membership.schoolId,
      userId: user.id,
      action: 'teacher.password_reset',
      resource: 'Teacher',
      resourceId: teacher.id,
      metadata: {
        teacherId: teacher.id,
        targetUserId: teacher.userId,
      },
    });

    return emailsPaused
      ? {
          message: 'Teacher password reset; email delivery is paused',
          temporaryPassword,
          emailSent: false,
        }
      : { message: 'Teacher password reset email sent successfully' };
  }

  async assignSubject(
    user: RequestUser,
    teacherId: string,
    dto: AssignTeacherSubjectDto,
  ) {
    this.ensureAdmin(user);
    const membership = await this.getMembership(user);

    const teacher = await this.prisma.teacher.findFirst({
      where: {
        id: teacherId,
        schoolId: membership.schoolId,
      },
      select: { id: true },
    });

    if (!teacher) {
      throw new NotFoundException('Teacher not found in this school');
    }

    const subject = await this.prisma.subject.findFirst({
      where: {
        id: dto.subjectId,
        schoolId: membership.schoolId,
      },
      select: { id: true },
    });

    if (!subject) {
      throw new NotFoundException('Subject not found in this school');
    }

    const existing = await this.prisma.teacherSubject.findUnique({
      where: {
        teacherId_subjectId: {
          teacherId: teacher.id,
          subjectId: subject.id,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'Teacher is already assigned to this subject',
      );
    }

    return this.prisma.teacherSubject.create({
      data: {
        teacherId: teacher.id,
        subjectId: subject.id,
      },
      include: {
        teacher: true,
        subject: true,
      },
    });
  }

  async findAll(user: RequestUser, query: PaginationQueryDto = new PaginationQueryDto()) {
    this.ensureAdmin(user);

    const membership = await this.getMembership(user);

    const where: any = {
      schoolId: membership.schoolId,
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { employeeId: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const page = query.getPage();
    const limit = query.getLimit();
    const result = await this.prisma.teacher.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
          },
        },
        classAssignments: {
          include: {
            class: true,
          },
        },
        subjectAssignments: {
          include: {
            subject: true,
          },
        },
      },
      orderBy: { lastName: 'asc' },
      ...(query.paginated ? { skip: (page - 1) * limit, take: limit } : {}),
    });

    if (!query.paginated) {
      return result;
    }

    const total = await this.prisma.teacher.count({ where });
    return {
      data: result,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(user: RequestUser, id: string) {
    const membership = await this.getMembership(user);

    const teacher = await this.prisma.teacher.findFirst({
      where: {
        id,
        schoolId: membership.schoolId,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
          },
        },
        classAssignments: {
          include: {
            class: true,
          },
        },
        subjectAssignments: {
          include: {
            subject: true,
          },
        },
        attendanceRecords: true,
        results: true,
        timetableEntries: true,
      },
    });

    if (!teacher) {
      throw new NotFoundException('Teacher not found');
    }

    if (user.role === UserRole.TEACHER && teacher.userId !== user.id) {
      throw new ForbiddenException('You can only view your own teacher profile');
    }

    return teacher;
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateTeacherDto,
  ) {
    const membership = await this.getMembership(user);

    const teacher = await this.prisma.teacher.findFirst({
      where: {
        id,
        schoolId: membership.schoolId,
      },
    });

    if (!teacher) {
      throw new NotFoundException('Teacher not found');
    }

    if (user.role === UserRole.TEACHER && teacher.userId !== user.id) {
      throw new ForbiddenException('You can only update your own teacher profile');
    }

    if (user.role === UserRole.TEACHER) {
      const restrictedFields = [
        dto.firstName,
        dto.lastName,
        dto.employeeId,
        dto.email,
      ].filter((value) => value !== undefined && value !== null);

      if (restrictedFields.length > 0) {
        throw new ForbiddenException(
          'Teachers can only update their contact information',
        );
      }
    }

    if (dto.employeeId && dto.employeeId !== teacher.employeeId) {
      const existingTeacher =
        await this.prisma.teacher.findFirst({
          where: {
            schoolId: membership.schoolId,
            employeeId: dto.employeeId,
            NOT: {
              id,
            },
          },
        });

      if (existingTeacher) {
        throw new ConflictException(
          'A teacher with this employee ID already exists in this school',
        );
      }
    }

    if (dto.email && dto.email !== teacher.email) {
      const existingUser = await this.prisma.user.findUnique({
        where: {
          email: dto.email,
        },
      });

      if (existingUser && existingUser.id !== teacher.userId) {
        throw new ConflictException(
          'A user with this email already exists',
        );
      }
    }

    const teacherUpdateData = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      employeeId: dto.employeeId,
      email: dto.email,
      phone: dto.phone,
      address: dto.address,
      photoUrl: dto.photoUrl,
    };

    const userUpdateData: {
      email?: string | null;
      firstName?: string;
      lastName?: string;
      phone?: string | null;
    } = {
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
    };

    const filteredTeacherUpdateData = Object.fromEntries(
      Object.entries(teacherUpdateData).filter(([, value]) => value !== undefined),
    );

    const filteredUserUpdateData = Object.fromEntries(
      Object.entries(userUpdateData).filter(([, value]) => value !== undefined),
    );

    const updatedTeacher = await this.prisma.$transaction(async (tx) => {
      const result = await tx.teacher.update({
        where: { id },
        data: filteredTeacherUpdateData,
      });

      if (Object.keys(filteredUserUpdateData).length > 0) {
        await tx.user.update({
          where: { id: teacher.userId },
          data: filteredUserUpdateData,
        });
      }

      await tx.auditLog.create({
        data: {
          schoolId: membership.schoolId,
          userId: user.id,
          action: 'teacher.updated',
          resource: 'Teacher',
          resourceId: teacher.id,
          metadata: {
            teacherId: teacher.id,
            updatedFields: Object.keys(filteredTeacherUpdateData),
          },
        },
      });

      return result;
    });

    return updatedTeacher;
  }

  async remove(
    user: RequestUser,
    id: string,
  ) {
    this.ensureAdmin(user);

    const membership = await this.getMembership(user);

    const teacher = await this.prisma.teacher.findFirst({
      where: {
        id,
        schoolId: membership.schoolId,
      },
    });

    if (!teacher) {
      throw new NotFoundException('Teacher not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.teacher.delete({
        where: { id },
      });

      await tx.schoolMembership.deleteMany({
        where: {
          userId: teacher.userId,
          schoolId: membership.schoolId,
        },
      });

      await tx.refreshToken.updateMany({
        where: {
          userId: teacher.userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      const remainingMemberships = await tx.schoolMembership.count({
        where: { userId: teacher.userId },
      });

      if (remainingMemberships === 0) {
        await tx.user.update({
          where: { id: teacher.userId },
          data: { status: UserStatus.INACTIVE },
        });
      }
    });

    await this.auditLog.create({
      schoolId: membership.schoolId,
      userId: user.id,
      action: 'teacher.deleted',
      resource: 'Teacher',
      resourceId: teacher.id,
      metadata: {
        teacherId: teacher.id,
        userId: teacher.userId,
      },
    });

    return {
      message: 'Teacher removed successfully',
    };
  }
}
