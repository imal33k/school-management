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
  UserRole,
} from '@prisma/client';

import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentStatusDto } from './dto/update-enrollment-status.dto';

@Injectable()
export class EnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private ensureAdmin(user: RequestUser) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only school administrators can manage enrollments',
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
    dto: CreateEnrollmentDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const student =
      await this.prisma.student.findFirst({
        where: {
          id: dto.studentId,
          schoolId: membership.schoolId,
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found',
      );
    }

    const schoolClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          id: dto.classId,
          schoolId: membership.schoolId,
        },
        include: {
          academicSession: true,
        },
      });

    if (!schoolClass) {
      throw new NotFoundException(
        'Class not found',
      );
    }

    const existingEnrollment =
      await this.prisma.enrollment.findUnique({
        where: {
          studentId_academicSessionId: {
            studentId: student.id,
            academicSessionId:
              schoolClass.academicSessionId,
          },
        },
      });

    if (existingEnrollment) {
      throw new ConflictException(
        'This student is already enrolled for this academic session',
      );
    }

    if (
      schoolClass.capacity !== null
    ) {
      const enrollmentCount =
        await this.prisma.enrollment.count({
          where: {
            classId: schoolClass.id,
            status: EnrollmentStatus.ACTIVE,
          },
        });

      if (
        enrollmentCount >=
        Number(schoolClass.capacity)
      ) {
        throw new ConflictException(
          'This class has reached its capacity',
        );
      }
    }

    return this.prisma.enrollment.create({
      data: {
        studentId: student.id,
        classId: schoolClass.id,
        academicSessionId:
          schoolClass.academicSessionId,
        status: EnrollmentStatus.ACTIVE,
      },
      include: {
        student: true,
        class: true,
        academicSession: true,
      },
    });
  }

  async findAll(
    user: RequestUser,
  ) {
    const membership =
      await this.getMembership(user);

    return this.prisma.enrollment.findMany({
      where: {
        class: {
          schoolId: membership.schoolId,
        },
      },
      include: {
        student: true,
        class: true,
        academicSession: true,
      },
      orderBy: {
        enrolledAt: 'desc',
      },
    });
  }

  async findByClass(
    user: RequestUser,
    classId: string,
  ) {
    const membership =
      await this.getMembership(user);

    const schoolClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          id: classId,
          schoolId: membership.schoolId,
        },
      });

    if (!schoolClass) {
      throw new NotFoundException(
        'Class not found',
      );
    }

    return this.prisma.enrollment.findMany({
      where: {
        classId,
      },
      include: {
        student: true,
        academicSession: true,
      },
      orderBy: {
        student: {
          lastName: 'asc',
        },
      },
    });
  }

  async findByStudent(
    user: RequestUser,
    studentId: string,
  ) {
    const membership =
      await this.getMembership(user);

    const student =
      await this.prisma.student.findFirst({
        where: {
          id: studentId,
          schoolId: membership.schoolId,
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found',
      );
    }

    return this.prisma.enrollment.findMany({
      where: {
        studentId,
      },
      include: {
        class: true,
        academicSession: true,
      },
      orderBy: {
        enrolledAt: 'desc',
      },
    });
  }

  async findOne(
    user: RequestUser,
    id: string,
  ) {
    const membership =
      await this.getMembership(user);

    const enrollment =
      await this.prisma.enrollment.findFirst({
        where: {
          id,
          class: {
            schoolId: membership.schoolId,
          },
        },
        include: {
          student: true,
          class: true,
          academicSession: true,
        },
      });

    if (!enrollment) {
      throw new NotFoundException(
        'Enrollment not found',
      );
    }

    return enrollment;
  }

  async updateStatus(
    user: RequestUser,
    id: string,
    dto: UpdateEnrollmentStatusDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const enrollment =
      await this.prisma.enrollment.findFirst({
        where: {
          id,
          class: {
            schoolId: membership.schoolId,
          },
        },
      });

    if (!enrollment) {
      throw new NotFoundException(
        'Enrollment not found',
      );
    }

    return this.prisma.enrollment.update({
      where: {
        id,
      },
      data: {
        status: dto.status,
      },
      include: {
        student: true,
        class: true,
        academicSession: true,
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

    const enrollment =
      await this.prisma.enrollment.findFirst({
        where: {
          id,
          class: {
            schoolId: membership.schoolId,
          },
        },
      });

    if (!enrollment) {
      throw new NotFoundException(
        'Enrollment not found',
      );
    }

    await this.prisma.enrollment.delete({
      where: {
        id,
      },
    });

    return {
      message:
        'Enrollment removed successfully',
    };
  }
}