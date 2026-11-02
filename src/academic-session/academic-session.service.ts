import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import {
  RequestUser,
} from '../auth/decorator/current-user.decorator';

import { EnrollmentStatus, StudentStatus, UserRole } from '@prisma/client';

import { CreateAcademicSessionDto } from './dto/create-academic-session.dto';
import { UpdateAcademicSessionDto } from './dto/update-academic-session.dto';

@Injectable()
export class AcademicSessionService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private ensureAdmin(user: RequestUser) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only school administrators can manage academic sessions',
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

  async create(
    user: RequestUser,
    dto: CreateAcademicSessionDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (startDate >= endDate) {
      throw new BadRequestException(
        'Start date must be before end date',
      );
    }

    const existingSession =
      await this.prisma.academicSession.findFirst({
        where: {
          schoolId: membership.schoolId,
          name: dto.name,
        },
      });

    if (existingSession) {
      throw new ConflictException(
        'An academic session with this name already exists in this school',
      );
    }

    return this.prisma.academicSession.create({
      data: {
        schoolId: membership.schoolId,
        name: dto.name,
        startDate,
        endDate,
        isActive: false,
      },
    });
  }

  async findAll(user: RequestUser) {
    const membership =
      await this.getMembership(user);

    return this.prisma.academicSession.findMany({
      where: {
        schoolId: membership.schoolId,
      },
      include: {
        terms: true,
        _count: {
          select: { classes: true, enrollments: true },
        },
      },
      orderBy: {
        startDate: 'desc',
      },
    });
  }

  async findOne(
    id: string,
    user: RequestUser,
  ) {
    const membership =
      await this.getMembership(user);

    const session =
      await this.prisma.academicSession.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
        include: {
          terms: {
            orderBy: {
              startDate: 'asc',
            },
          },
          classes: true,
        },
      });

    if (!session) {
      throw new NotFoundException(
        'Academic session not found',
      );
    }

    return session;
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateAcademicSessionDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const session =
      await this.prisma.academicSession.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!session) {
      throw new NotFoundException(
        'Academic session not found',
      );
    }

    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : session.startDate;

    const endDate = dto.endDate
      ? new Date(dto.endDate)
      : session.endDate;

    if (startDate >= endDate) {
      throw new BadRequestException(
        'Start date must be before end date',
      );
    }

    const outOfBoundsTerm = await this.prisma.term.findFirst({
      where: {
        academicSessionId: session.id,
        OR: [
          { startDate: { lt: startDate } },
          { endDate: { gt: endDate } },
        ],
      },
      select: { id: true },
    });
    if (outOfBoundsTerm) {
      throw new ConflictException(
        'Session dates cannot exclude dates from an existing term',
      );
    }

    if (dto.name && dto.name !== session.name) {
      const existingSession =
        await this.prisma.academicSession.findFirst({
          where: {
            schoolId: membership.schoolId,
            name: dto.name,
            NOT: {
              id,
            },
          },
        });

      if (existingSession) {
        throw new ConflictException(
          'An academic session with this name already exists in this school',
        );
      }
    }

    return this.prisma.academicSession.update({
      where: {
        id,
      },
      data: {
        name: dto.name,
        startDate,
        endDate,
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

    const session =
      await this.prisma.academicSession.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
        include: {
          _count: {
            select: {
              classes: true,
              examinations: true,
              enrollments: true,
              terms: true,
            },
          },
        },
      });

    if (!session) {
      throw new NotFoundException(
        'Academic session not found',
      );
    }

    if (Object.values(session._count).some((count) => count > 0)) {
      throw new ConflictException(
        'Academic sessions with classes, terms, enrollments, or examinations cannot be deleted',
      );
    }

    if (session.isActive) {
      throw new BadRequestException(
        'The active academic session cannot be deleted',
      );
    }

    return this.prisma.academicSession.delete({
      where: {
        id,
      },
    });
  }

  async activate(
    user: RequestUser,
    id: string,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const session =
      await this.prisma.academicSession.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!session) {
      throw new NotFoundException(
        'Academic session not found',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const otherSessions = await tx.academicSession.findMany({
        where: {
          schoolId: membership.schoolId,
          id: { not: id },
        },
        select: { id: true },
      });
      if (otherSessions.length) {
        await tx.term.updateMany({
          where: {
            academicSessionId: {
              in: otherSessions.map((otherSession) => otherSession.id),
            },
            isActive: true,
          },
          data: { isActive: false },
        });
      }
      await tx.academicSession.updateMany({
        where: {
          schoolId: membership.schoolId,
          isActive: true,
        },
        data: { isActive: false },
      });
      return tx.academicSession.update({
        where: { id },
        data: { isActive: true },
      });
    });
  }

  async rollover(user: RequestUser, targetSessionId: string) {
    this.ensureAdmin(user);
    const membership = await this.getMembership(user);

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.academicSession.findFirst({
        where: {
          id: targetSessionId,
          schoolId: membership.schoolId,
        },
        include: {
          _count: {
            select: { classes: true, enrollments: true },
          },
        },
      });
      if (!target) {
        throw new NotFoundException('Target academic session not found');
      }
      if (target.isActive) {
        throw new BadRequestException(
          'Choose an inactive target session for rollover',
        );
      }
      if (target._count.classes || target._count.enrollments) {
        throw new ConflictException(
          'Rollover requires a target session with no classes or enrollments',
        );
      }

      const source = await tx.academicSession.findFirst({
        where: {
          schoolId: membership.schoolId,
          isActive: true,
          id: { not: target.id },
        },
        include: {
          classes: {
            include: {
              subjects: { select: { subjectId: true } },
              teachers: { select: { teacherId: true, isPrimary: true } },
              timetableEntries: {
                select: {
                  subjectId: true,
                  teacherId: true,
                  day: true,
                  startTime: true,
                  endTime: true,
                  room: true,
                },
              },
              enrollments: {
                where: {
                  status: EnrollmentStatus.ACTIVE,
                  student: { status: StudentStatus.ACTIVE },
                },
                select: { studentId: true },
              },
            },
          },
        },
      });
      if (!source) {
        throw new NotFoundException(
          'An active source academic session was not found',
        );
      }
      if (!source.classes.length) {
        throw new ConflictException(
          'The active session has no classes to roll over',
        );
      }

      let classesCopied = 0;
      for (const sourceClass of source.classes) {
        const targetClass = await tx.schoolClass.create({
          data: {
            schoolId: membership.schoolId,
            academicSessionId: target.id,
            name: sourceClass.name,
            level: sourceClass.level,
            capacity: sourceClass.capacity,
          },
          select: { id: true },
        });
        classesCopied += 1;

        if (sourceClass.subjects.length) {
          await tx.classSubject.createMany({
            data: sourceClass.subjects.map(({ subjectId }) => ({
              classId: targetClass.id,
              subjectId,
            })),
          });
        }
        if (sourceClass.teachers.length) {
          await tx.classTeacher.createMany({
            data: sourceClass.teachers.map(({ teacherId, isPrimary }) => ({
              classId: targetClass.id,
              teacherId,
              isPrimary,
            })),
          });
        }
        if (sourceClass.timetableEntries.length) {
          await tx.timetableEntry.createMany({
            data: sourceClass.timetableEntries.map((entry) => ({
              ...entry,
              classId: targetClass.id,
            })),
          });
        }
        if (sourceClass.enrollments.length) {
          await tx.enrollment.createMany({
            data: sourceClass.enrollments.map(({ studentId }) => ({
              studentId,
              classId: targetClass.id,
              academicSessionId: target.id,
              status: EnrollmentStatus.ACTIVE,
            })),
          });
        }
      }

      return {
        sourceSessionId: source.id,
        targetSessionId: target.id,
        classes: classesCopied,
        classAssignments: source.classes.reduce(
          (total, schoolClass) =>
            total + schoolClass.subjects.length + schoolClass.teachers.length,
          0,
        ),
        timetableEntries: source.classes.reduce(
          (total, schoolClass) =>
            total + schoolClass.timetableEntries.length,
          0,
        ),
        studentEnrollments: source.classes.reduce(
          (total, schoolClass) =>
            total + schoolClass.enrollments.length,
          0,
        ),
      };
    });
  }
}