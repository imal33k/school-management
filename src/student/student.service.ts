import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import {
  CurrentUser,
  RequestUser,
} from '../auth/decorator/current-user.decorator';

import { UserRole } from '@prisma/client';

import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { PlanLimitService } from '../plans/plan-limit.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Injectable()
export class StudentService {
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
        'Only school administrators can manage students',
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
    dto: CreateStudentDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    await this.planLimits.ensureCanCreate(membership.schoolId, 'students');

    const existingStudent =
      await this.prisma.student.findFirst({
        where: {
          schoolId: membership.schoolId,
          admissionNumber: dto.admissionNumber,
        },
      });

    if (existingStudent) {
      throw new ConflictException(
        'A student with this admission number already exists in this school',
      );
    }

    if (dto.email) {
      const existingStudentEmail =
        await this.prisma.student.findFirst({
          where: {
            schoolId: membership.schoolId,
            email: dto.email,
          },
        });

      if (existingStudentEmail) {
        throw new ConflictException(
          'A student with this email already exists in this school',
        );
      }
    }

    return this.prisma.student.create({
      data: {
        schoolId: membership.schoolId,
        admissionNumber: dto.admissionNumber,
        firstName: dto.firstName,
        middleName: dto.middleName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth
          ? new Date(dto.dateOfBirth)
          : undefined,
        gender: dto.gender,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        photoUrl: dto.photoUrl,
        admissionDate: dto.admissionDate
          ? new Date(dto.admissionDate)
          : undefined,
      },
    });
  }


  async findMe(user: RequestUser) {
    const student = await this.prisma.student.findFirst({ where: { userId: user.id }, include: {
      enrollments: { include: { class: true, academicSession: true } },
      guardians: { include: { parent: true } },
      attendance: { orderBy: { date: 'desc' }, take: 100 },
      results: { include: { examination: true, subject: true, term: true }, orderBy: { createdAt: 'desc' } },
      invoices: { include: { term: true, feeStructure: true, payments: true }, orderBy: { createdAt: 'desc' } },
    }});
    if (!student) throw new NotFoundException('Student profile not found');
    return student;
  }

  async findAll(user: RequestUser, query: PaginationQueryDto = new PaginationQueryDto()) {
    const membership =
      await this.getMembership(user);

    const where: any = { schoolId: membership.schoolId, ...(query.search ? { OR: [
      { firstName: { contains: query.search, mode: 'insensitive' } },
      { lastName: { contains: query.search, mode: 'insensitive' } },
      { admissionNumber: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
    ] } : {}) };
    const page = query.getPage(); const limit = query.getLimit();
    const result = await this.prisma.student.findMany({ where,
      include: {
        guardians: {
          include: {
            parent: true,
          },
        },
        enrollments: {
          include: {
            class: true,
            academicSession: true,
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      ...(query.paginated ? { skip: (page - 1) * limit, take: limit } : {}),
    });
    if (!query.paginated) return result;
    const total = await this.prisma.student.count({ where });
    return { data: result, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(
    user: RequestUser,
    id: string,
  ) {
    const membership =
      await this.getMembership(user);

    const student =
      await this.prisma.student.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
        include: {
          guardians: {
            include: {
              parent: true,
            },
          },
          enrollments: {
            include: {
              class: true,
              academicSession: true,
            },
          },
          attendance: {
            orderBy: {
              date: 'desc',
            },
          },
          results: {
            include: {
              examination: true,
              subject: true,
              term: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
          invoices: {
            include: {
              feeStructure: true,
              term: true,
              payments: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found',
      );
    }

    return student;
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateStudentDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const student =
      await this.prisma.student.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found',
      );
    }

    if (
      dto.admissionNumber &&
      dto.admissionNumber !==
        student.admissionNumber
    ) {
      const existingStudent =
        await this.prisma.student.findFirst({
          where: {
            schoolId: membership.schoolId,
            admissionNumber:
              dto.admissionNumber,
            NOT: {
              id,
            },
          },
        });

      if (existingStudent) {
        throw new ConflictException(
          'A student with this admission number already exists in this school',
        );
      }
    }

    if (
      dto.email &&
      dto.email !== student.email
    ) {
      const existingStudent =
        await this.prisma.student.findFirst({
          where: {
            schoolId: membership.schoolId,
            email: dto.email,
            NOT: {
              id,
            },
          },
        });

      if (existingStudent) {
        throw new ConflictException(
          'A student with this email already exists in this school',
        );
      }
    }

    return this.prisma.student.update({
      where: {
        id,
      },
      data: {
        admissionNumber:
          dto.admissionNumber,
        firstName: dto.firstName,
        middleName: dto.middleName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth
          ? new Date(dto.dateOfBirth)
          : undefined,
        gender: dto.gender,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        photoUrl: dto.photoUrl,
        admissionDate:
          dto.admissionDate
            ? new Date(dto.admissionDate)
            : undefined,
      },
    });
  }

  async remove(
    user: RequestUser,
    id: string,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const student =
      await this.prisma.student.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found',
      );
    }

    await this.prisma.student.delete({
      where: {
        id,
      },
    });

    return {
      message: 'Student removed successfully',
    };
  }
}