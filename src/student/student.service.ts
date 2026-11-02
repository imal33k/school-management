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

import {
  EnrollmentStatus,
  StudentStatus,
  UserRole,
} from '@prisma/client';

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

  private ensureSchoolStaff(user: RequestUser) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.TEACHER
    ) {
      throw new ForbiddenException(
        'Only school administrators and teachers can access student records',
      );
    }
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

  private async getTeacherClassIds(user: RequestUser, schoolId: string) {
    const teacher = await this.prisma.teacher.findFirst({
      where: {
        userId: user.id,
        schoolId,
      },
      select: { id: true },
    });

    if (!teacher) {
      throw new ForbiddenException('Teacher profile not found');
    }

    const assignments = await this.prisma.classTeacher.findMany({
      where: { teacherId: teacher.id },
      select: { classId: true },
    });

    return assignments.map(({ classId }) => classId);
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
    if (user.role !== UserRole.STUDENT) {
      throw new ForbiddenException(
        'Only students can access their student profile',
      );
    }

    const student = await this.prisma.student.findFirst({
      where: { userId: user.id },
      include: {
        enrollments: { include: { class: true, academicSession: true } },
        guardians: { include: { parent: true } },
        attendance: { orderBy: { date: 'desc' }, take: 100 },
        results: {
          where: { examination: { status: 'PUBLISHED' } },
          include: { examination: true, subject: true, term: true },
          orderBy: { createdAt: 'desc' },
        },
        invoices: { include: { term: true, feeStructure: true, payments: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!student) throw new NotFoundException('Student profile not found');
    return student;
  }

  async findAll(user: RequestUser, query: PaginationQueryDto = new PaginationQueryDto()) {
    this.ensureSchoolStaff(user);

    const membership =
      await this.getMembership(user);

    const teacherClassIds =
      user.role === UserRole.TEACHER
        ? await this.getTeacherClassIds(user, membership.schoolId)
        : undefined;
    const where: any = {
      schoolId: membership.schoolId,
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { admissionNumber: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(teacherClassIds
        ? {
            enrollments: {
              some: {
                classId: { in: teacherClassIds },
                status: 'ACTIVE',
              },
            },
          }
        : {}),
    };
    const page = query.getPage(); const limit = query.getLimit();
    const result = await this.prisma.student.findMany({ where,
      include: {
        guardians: {
          include: {
            parent: true,
          },
        },
        enrollments: {
          ...(teacherClassIds
            ? {
                where: {
                  classId: { in: teacherClassIds },
                  status: 'ACTIVE',
                },
              }
            : {}),
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

  async findByClass(user: RequestUser, classId: string) {
    this.ensureSchoolStaff(user);
    const membership = await this.getMembership(user);

    const schoolClass = await this.prisma.schoolClass.findFirst({
      where: {
        id: classId,
        schoolId: membership.schoolId,
      },
      select: { id: true },
    });

    if (!schoolClass) {
      throw new NotFoundException('Class not found');
    }

    if (user.role === UserRole.TEACHER) {
      const teacherClassIds = await this.getTeacherClassIds(
        user,
        membership.schoolId,
      );
      if (!teacherClassIds.includes(schoolClass.id)) {
        throw new ForbiddenException('You are not assigned to this class');
      }
    }

    return this.prisma.student.findMany({
      where: {
        schoolId: membership.schoolId,
        enrollments: {
          some: {
            classId: schoolClass.id,
            status: 'ACTIVE',
          },
        },
      },
      include: {
        guardians: {
          include: {
            parent: true,
          },
        },
        enrollments: {
          where: {
            classId: schoolClass.id,
            status: 'ACTIVE',
          },
          include: {
            class: true,
            academicSession: true,
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async findOne(
    user: RequestUser,
    id: string,
  ) {
    if (user.role === UserRole.STUDENT) {
      const student = await this.prisma.student.findFirst({
        where: {
          id,
          userId: user.id,
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
            where: {
              examination: { status: 'PUBLISHED' },
            },
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
        throw new NotFoundException('Student not found');
      }

      return student;
    }

    this.ensureSchoolStaff(user);
    const membership =
      await this.getMembership(user);
    const teacherClassIds =
      user.role === UserRole.TEACHER
        ? await this.getTeacherClassIds(user, membership.schoolId)
        : undefined;

    const student =
      await this.prisma.student.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
          ...(teacherClassIds
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
        include: {
          guardians: {
            include: {
              parent: true,
            },
          },
          enrollments: {
            ...(teacherClassIds
              ? {
                  where: {
                    classId: { in: teacherClassIds },
                    status: 'ACTIVE',
                  },
                }
              : {}),
            include: {
              class: true,
              academicSession: true,
            },
          },
          attendance: {
            ...(teacherClassIds
              ? { where: { classId: { in: teacherClassIds } } }
              : {}),
            orderBy: {
              date: 'desc',
            },
          },
          results: {
            ...(teacherClassIds
              ? {
                  where: {
                    examination: {
                      classId: { in: teacherClassIds },
                    },
                  },
                }
              : {}),
            include: {
              examination: true,
              subject: true,
              term: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
          ...(teacherClassIds
            ? {}
            : {
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
              }),
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

    return this.prisma.$transaction(async (tx) => {
      const updatedStudent = await tx.student.update({
        where: { id },
        data: {
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
          status: dto.status,
        },
      });

      const terminalEnrollmentStatus =
        dto.status === StudentStatus.GRADUATED
          ? EnrollmentStatus.COMPLETED
          : dto.status === StudentStatus.TRANSFERRED
            ? EnrollmentStatus.TRANSFERRED
            : undefined;
      if (terminalEnrollmentStatus) {
        await tx.enrollment.updateMany({
          where: {
            studentId: id,
            status: EnrollmentStatus.ACTIVE,
          },
          data: { status: terminalEnrollmentStatus },
        });
      }

      return updatedStudent;
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
        include: {
          _count: {
            select: {
              attendance: true,
              enrollments: true,
              invoices: true,
              payments: true,
              results: true,
              guardians: true,
            },
          },
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found',
      );
    }

    if (Object.values(student._count).some((count) => count > 0)) {
      throw new ConflictException(
        'Students with academic, enrollment, guardian, or payment history cannot be deleted; mark the student inactive instead',
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