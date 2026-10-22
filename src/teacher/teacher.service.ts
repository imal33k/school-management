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

import { UserRole } from '@prisma/client';

import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';

import * as bcrypt from 'bcrypt';
import { PlanLimitService } from '../plans/plan-limit.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Injectable()
export class TeacherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitService,
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

  private async getMembership(user: RequestUser) {
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
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

    if (dto.email) {
      const existingUser =
        await this.prisma.user.findUnique({
          where: {
            email: dto.email,
          },
        });

      if (existingUser) {
        throw new ConflictException(
          'A user with this email already exists',
        );
      }
    }

    const temporaryPassword =
      Math.random().toString(36).slice(-10);

    const hashedPassword =
      await bcrypt.hash(
        temporaryPassword,
        10,
      );

    const teacher =
      await this.prisma.$transaction(
        async (tx) => {
          const teacherUser =
            await tx.user.create({
              data: {
                email:
                  dto.email ??
                  `${dto.employeeId}@teacher.local`,
                firstName: dto.firstName,
                lastName: dto.lastName,
                phone: dto.phone,
                password: hashedPassword,
                role: UserRole.TEACHER,
              },
            });

          await tx.schoolMembership.create({
            data: {
              userId: teacherUser.id,
              schoolId: membership.schoolId,
              role: UserRole.TEACHER,
            },
          });

          return tx.teacher.create({
            data: {
              schoolId:
                membership.schoolId,
              userId: teacherUser.id,
              employeeId:
                dto.employeeId,
              firstName:
                dto.firstName,
              lastName:
                dto.lastName,
              email: dto.email,
              phone: dto.phone,
              address: dto.address,
              photoUrl: dto.photoUrl,
            },
          });
        },
      );

    return {
      teacher,
      temporaryPassword,
    };
  }


  async resetPassword(user: RequestUser, id: string) {
    this.ensureAdmin(user);
    const membership = await this.getMembership(user);
    const teacher = await this.prisma.teacher.findFirst({ where: { id, schoolId: membership.schoolId }, include: { user: true } });
    if (!teacher) throw new NotFoundException('Teacher not found');
    const temporaryPassword = Math.random().toString(36).slice(-10);
    await this.prisma.user.update({ where: { id: teacher.userId }, data: { password: await bcrypt.hash(temporaryPassword, 10) } });
    return { message: 'Teacher password reset successfully', temporaryPassword };
  }

  async findAll(user: RequestUser, query: PaginationQueryDto = new PaginationQueryDto()) {
    const membership =
      await this.getMembership(user);

    const where: any = { schoolId: membership.schoolId, ...(query.search ? { OR: [
      { firstName: { contains: query.search, mode: 'insensitive' } },
      { lastName: { contains: query.search, mode: 'insensitive' } },
      { employeeId: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
    ] } : {}) };
    const page = query.getPage(); const limit = query.getLimit();
    const result = await this.prisma.teacher.findMany({ where,
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
    if (!query.paginated) return result;
    const total = await this.prisma.teacher.count({ where });
    return { data: result, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(
    user: RequestUser,
    id: string,
  ) {
    const membership =
      await this.getMembership(user);

    const teacher =
      await this.prisma.teacher.findFirst({
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
      throw new NotFoundException(
        'Teacher not found',
      );
    }

    return teacher;
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateTeacherDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const teacher =
      await this.prisma.teacher.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!teacher) {
      throw new NotFoundException(
        'Teacher not found',
      );
    }

    if (
      dto.employeeId &&
      dto.employeeId !== teacher.employeeId
    ) {
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

    if (
      dto.email &&
      dto.email !== teacher.email
    ) {
      const existingUser =
        await this.prisma.user.findUnique({
          where: {
            email: dto.email,
          },
        });

      if (
        existingUser &&
        existingUser.id !== teacher.userId
      ) {
        throw new ConflictException(
          'A user with this email already exists',
        );
      }
    }

    return this.prisma.$transaction(
      async (tx) => {
        const updatedTeacher =
          await tx.teacher.update({
            where: {
              id,
            },
            data: {
              firstName:
                dto.firstName,
              lastName:
                dto.lastName,
              employeeId:
                dto.employeeId,
              email:
                dto.email,
              phone:
                dto.phone,
              address:
                dto.address,
              photoUrl:
                dto.photoUrl,
            },
          });

        await tx.user.update({
          where: {
            id: teacher.userId,
          },
          data: {
            email:
              dto.email,
            firstName:
              dto.firstName,
            lastName:
              dto.lastName,
            phone:
              dto.phone,
          },
        });

        return updatedTeacher;
      },
    );
  }

  async remove(
    user: RequestUser,
    id: string,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const teacher =
      await this.prisma.teacher.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!teacher) {
      throw new NotFoundException(
        'Teacher not found',
      );
    }

    await this.prisma.teacher.delete({
      where: {
        id,
      },
    });

    return {
      message: 'Teacher removed successfully',
    };
  }
}