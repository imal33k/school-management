import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import {
  UserRole,
  DayOfWeek,
} from '@prisma/client';

import type { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreateTimetableEntryDto } from './dto/create-timetable-entry.dto';
import { UpdateTimetableEntryDto } from './dto/update-timetable-entry.dto';

@Injectable()
export class TimetableService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(
    user: RequestUser,
    dto: CreateTimetableEntryDto,
  ) {
    const membership = await this.getAdminMembership(user);

    const schoolId = membership.schoolId;

    const schoolClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          id: dto.classId,
          schoolId,
        },
      });

    if (!schoolClass) {
      throw new NotFoundException(
        'Class not found in your school',
      );
    }

    const subject =
      await this.prisma.subject.findFirst({
        where: {
          id: dto.subjectId,
          schoolId,
        },
      });

    if (!subject) {
      throw new NotFoundException(
        'Subject not found in your school',
      );
    }

    const classSubject =
      await this.prisma.classSubject.findFirst({
        where: {
          classId: dto.classId,
          subjectId: dto.subjectId,
        },
      });

    if (!classSubject) {
      throw new BadRequestException(
        'Subject is not assigned to this class',
      );
    }

    if (dto.teacherId) {
      await this.validateTeacherAssignment(
        dto.teacherId,
        dto.classId,
        dto.subjectId,
        schoolId,
      );
    }

    this.validateTime(
      dto.startTime,
      dto.endTime,
    );

    const conflict =
      await this.prisma.timetableEntry.findFirst({
        where: {
          classId: dto.classId,
          day: dto.day,
          OR: [
            {
              startTime: {
                lt: dto.endTime,
              },
              endTime: {
                gt: dto.startTime,
              },
            },
          ],
        },
      });

    if (conflict) {
      throw new BadRequestException(
        'This class already has a timetable entry during this time',
      );
    }

    if (dto.teacherId) {
      const teacherConflict =
        await this.prisma.timetableEntry.findFirst({
          where: {
            teacherId: dto.teacherId,
            day: dto.day,
            OR: [
              {
                startTime: {
                  lt: dto.endTime,
                },
                endTime: {
                  gt: dto.startTime,
                },
              },
            ],
          },
        });

      if (teacherConflict) {
        throw new BadRequestException(
          'This teacher already has a timetable entry during this time',
        );
      }
    }

    return this.prisma.timetableEntry.create({
      data: {
        classId: dto.classId,
        subjectId: dto.subjectId,
        teacherId: dto.teacherId,
        day: dto.day,
        startTime: dto.startTime,
        endTime: dto.endTime,
        room: dto.room,
      },
      include: {
        class: true,
        subject: true,
        teacher: true,
      },
    });
  }

  async findAll(user: RequestUser) {
    const membership =
      await this.getMembership(user);

    return this.prisma.timetableEntry.findMany({
      where: {
        class: {
          schoolId: membership.schoolId,
        },
      },
      include: {
        class: true,
        subject: true,
        teacher: true,
      },
      orderBy: [
        {
          day: 'asc',
        },
        {
          startTime: 'asc',
        },
      ],
    });
  }

  async findOne(
    user: RequestUser,
    id: string,
  ) {
    const membership =
      await this.getMembership(user);

    const entry =
      await this.prisma.timetableEntry.findFirst({
        where: {
          id,
          class: {
            schoolId: membership.schoolId,
          },
        },
        include: {
          class: true,
          subject: true,
          teacher: true,
        },
      });

    if (!entry) {
      throw new NotFoundException(
        'Timetable entry not found',
      );
    }

    return entry;
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateTimetableEntryDto,
  ) {
    await this.checkAdmin(user);

    const membership =
      await this.getAdminMembership(user);

    const existing =
      await this.prisma.timetableEntry.findFirst({
        where: {
          id,
          class: {
            schoolId: membership.schoolId,
          },
        },
      });

    if (!existing) {
      throw new NotFoundException(
        'Timetable entry not found',
      );
    }

    const classId =
      dto.classId ?? existing.classId;

    const subjectId =
      dto.subjectId ?? existing.subjectId;

    const teacherId =
      dto.teacherId ?? existing.teacherId;

    const day =
      dto.day ?? existing.day;

    const startTime =
      dto.startTime ?? existing.startTime;

    const endTime =
      dto.endTime ?? existing.endTime;

    const schoolClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          id: classId,
          schoolId: membership.schoolId,
        },
      });

    if (!schoolClass) {
      throw new NotFoundException(
        'Class not found in your school',
      );
    }

    const subject =
      await this.prisma.subject.findFirst({
        where: {
          id: subjectId,
          schoolId: membership.schoolId,
        },
      });

    if (!subject) {
      throw new NotFoundException(
        'Subject not found in your school',
      );
    }

    const classSubject =
      await this.prisma.classSubject.findFirst({
        where: {
          classId,
          subjectId,
        },
      });

    if (!classSubject) {
      throw new BadRequestException(
        'Subject is not assigned to this class',
      );
    }

    if (teacherId) {
      await this.validateTeacherAssignment(
        teacherId,
        classId,
        subjectId,
        membership.schoolId,
      );
    }

    this.validateTime(
      startTime,
      endTime,
    );

    return this.prisma.timetableEntry.update({
      where: {
        id,
      },
      data: {
        classId,
        subjectId,
        teacherId,
        day,
        startTime,
        endTime,
        room: dto.room ?? existing.room,
      },
      include: {
        class: true,
        subject: true,
        teacher: true,
      },
    });
  }

  async remove(
    user: RequestUser,
    id: string,
  ) {
    await this.checkAdmin(user);

    const membership =
      await this.getAdminMembership(user);

    const entry =
      await this.prisma.timetableEntry.findFirst({
        where: {
          id,
          class: {
            schoolId: membership.schoolId,
          },
        },
      });

    if (!entry) {
      throw new NotFoundException(
        'Timetable entry not found',
      );
    }

    await this.prisma.timetableEntry.delete({
      where: {
        id,
      },
    });

    return {
      message:
        'Timetable entry deleted successfully',
    };
  }

  private async validateTeacherAssignment(
    teacherId: string,
    classId: string,
    subjectId: string,
    schoolId: string,
  ) {
    const teacher =
      await this.prisma.teacher.findFirst({
        where: {
          id: teacherId,
          schoolId,
        },
      });

    if (!teacher) {
      throw new NotFoundException(
        'Teacher not found in your school',
      );
    }

    const classTeacher =
      await this.prisma.classTeacher.findFirst({
        where: {
          classId,
          teacherId,
        },
      });

    if (!classTeacher) {
      throw new BadRequestException(
        'Teacher is not assigned to this class',
      );
    }

    const teacherSubject =
      await this.prisma.teacherSubject.findFirst({
        where: {
          teacherId,
          subjectId,
        },
      });

    if (!teacherSubject) {
      throw new BadRequestException(
        'Teacher is not assigned to this subject',
      );
    }
  }

  private validateTime(
    startTime: string,
    endTime: string,
  ) {
    if (startTime >= endTime) {
      throw new BadRequestException(
        'Start time must be before end time',
      );
    }
  }

  private async checkAdmin(
    user: RequestUser,
  ) {
    if (user.role !== UserRole.SCHOOL_ADMIN) {
      throw new ForbiddenException(
        'Only school administrators can manage the timetable',
      );
    }
  }

  private async getAdminMembership(
    user: RequestUser,
  ) {
    await this.checkAdmin(user);

    return this.getMembership(user);
  }

  private async getMembership(
    user: RequestUser,
  ) {
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
        },
      });

    if (!membership) {
      throw new ForbiddenException(
        'You do not belong to a school',
      );
    }

    return membership;
  }
}