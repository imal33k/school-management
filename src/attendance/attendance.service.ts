import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AttendanceStatus,
  EnrollmentStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private async getSchoolId(user: RequestUser): Promise<string> {
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          ...(user.schoolId ? { schoolId: user.schoolId } : {}),
        },
      });

    if (!membership) {
      throw new ForbiddenException(
        'You are not a member of any school',
      );
    }

    return membership.schoolId;
  }

  private ensureCanManageAttendance(user: RequestUser) {
    const allowedRoles: UserRole[] = [
      UserRole.SUPER_ADMIN,
      UserRole.SCHOOL_ADMIN,
      UserRole.TEACHER,
    ];

    if (!allowedRoles.includes(user.role)) {
      throw new ForbiddenException(
        'You do not have permission to manage attendance',
      );
    }
  }

  private normalizeDate(date: string): Date {
    const parsed = new Date(date);

    if (Number.isNaN(parsed.getTime())) {
      throw new ConflictException(
        'Invalid attendance date',
      );
    }

    return new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
      ),
    );
  }

  private async getTeacherForUser(
    user: RequestUser,
    schoolId: string,
  ) {
    const teacher =
      await this.prisma.teacher.findFirst({
        where: {
          userId: user.id,
          schoolId,
        },
      });

    if (!teacher) {
      throw new ForbiddenException(
        'Teacher profile not found',
      );
    }

    return teacher;
  }

  private async ensureTeacherCanAccessClass(
    teacherId: string,
    classId: string,
  ) {
    const assignment =
      await this.prisma.classTeacher.findUnique({
        where: {
          classId_teacherId: {
            classId,
            teacherId,
          },
        },
      });

    if (!assignment) {
      throw new ForbiddenException(
        'You are not assigned to this class',
      );
    }
  }

  async create(
    dto: CreateAttendanceDto,
    user: RequestUser,
  ) {
    this.ensureCanManageAttendance(user);

    const schoolId =
      await this.getSchoolId(user);

    const date =
      this.normalizeDate(dto.date);

    const student =
      await this.prisma.student.findFirst({
        where: {
          id: dto.studentId,
          schoolId,
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
          schoolId,
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

    if (
      date < schoolClass.academicSession.startDate ||
      date > schoolClass.academicSession.endDate
    ) {
      throw new ConflictException(
        'Attendance date is outside the academic session',
      );
    }

    const enrollment =
      await this.prisma.enrollment.findFirst({
        where: {
          studentId: student.id,
          classId: schoolClass.id,
          status: EnrollmentStatus.ACTIVE,
        },
      });

    if (!enrollment) {
      throw new ConflictException(
        'Student is not actively enrolled in this class',
      );
    }

    let teacherId: string | undefined;

    if (user.role === UserRole.TEACHER) {
      const teacher =
        await this.getTeacherForUser(
          user,
          schoolId,
        );

      await this.ensureTeacherCanAccessClass(
        teacher.id,
        schoolClass.id,
      );

      teacherId = teacher.id;
    }

    const existing =
      await this.prisma.attendance.findUnique({
        where: {
          studentId_date: {
            studentId: student.id,
            date,
          },
        },
      });

    if (existing) {
      throw new ConflictException(
        'Attendance already exists for this student on this date',
      );
    }

    return this.prisma.attendance.create({
      data: {
        studentId: student.id,
        classId: schoolClass.id,
        teacherId,
        date,
        status: dto.status,
        note: dto.note,
      },
      include: {
        student: true,
        class: true,
        teacher: true,
      },
    });
  }


  async findMine(user: RequestUser) {
    const student = await this.prisma.student.findFirst({ where: { userId: user.id } });
    if (!student) throw new NotFoundException('Student profile not found');
    return this.prisma.attendance.findMany({ where: { studentId: student.id }, include: { class: true, teacher: true }, orderBy: { date: 'desc' } });
  }

  async findAll(
    user: RequestUser,
    date?: string,
  ) {
    this.ensureCanManageAttendance(user);

    const schoolId =
      await this.getSchoolId(user);

    let normalizedDate: Date | undefined;

    if (date) {
      normalizedDate =
        this.normalizeDate(date);
    }

    return this.prisma.attendance.findMany({
      where: {
        class: {
          schoolId,
        },
        ...(normalizedDate
          ? {
              date: normalizedDate,
            }
          : {}),
      },
      include: {
        student: true,
        class: true,
        teacher: true,
      },
      orderBy: {
        date: 'desc',
      },
    });
  }

  async findByClass(
    classId: string,
    user: RequestUser,
    date?: string,
  ) {
    this.ensureCanManageAttendance(user);

    const schoolId =
      await this.getSchoolId(user);

    const schoolClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          id: classId,
          schoolId,
        },
      });

    if (!schoolClass) {
      throw new NotFoundException(
        'Class not found',
      );
    }

    let normalizedDate: Date | undefined;

    if (date) {
      normalizedDate =
        this.normalizeDate(date);
    }

    return this.prisma.attendance.findMany({
      where: {
        classId,
        ...(normalizedDate
          ? {
              date: normalizedDate,
            }
          : {}),
      },
      include: {
        student: true,
        teacher: true,
      },
      orderBy: {
        student: {
          lastName: 'asc',
        },
      },
    });
  }

  async findByStudent(
    studentId: string,
    user: RequestUser,
  ) {
    this.ensureCanManageAttendance(user);

    const schoolId =
      await this.getSchoolId(user);

    const student =
      await this.prisma.student.findFirst({
        where: {
          id: studentId,
          schoolId,
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found',
      );
    }

    return this.prisma.attendance.findMany({
      where: {
        studentId,
        class: {
          schoolId,
        },
      },
      include: {
        class: true,
        teacher: true,
      },
      orderBy: {
        date: 'desc',
      },
    });
  }

  async findOne(
    id: string,
    user: RequestUser,
  ) {
    this.ensureCanManageAttendance(user);

    const schoolId =
      await this.getSchoolId(user);

    const attendance =
      await this.prisma.attendance.findFirst({
        where: {
          id,
          class: {
            schoolId,
          },
        },
        include: {
          student: true,
          class: true,
          teacher: true,
        },
      });

    if (!attendance) {
      throw new NotFoundException(
        'Attendance record not found',
      );
    }

    return attendance;
  }

  async update(
    id: string,
    dto: UpdateAttendanceDto,
    user: RequestUser,
  ) {
    this.ensureCanManageAttendance(user);

    const schoolId =
      await this.getSchoolId(user);

    const attendance =
      await this.prisma.attendance.findFirst({
        where: {
          id,
          class: {
            schoolId,
          },
        },
        include: {
          class: true,
        },
      });

    if (!attendance) {
      throw new NotFoundException(
        'Attendance record not found',
      );
    }

    if (user.role === UserRole.TEACHER) {
      const teacher =
        await this.getTeacherForUser(
          user,
          schoolId,
        );

      await this.ensureTeacherCanAccessClass(
        teacher.id,
        attendance.classId,
      );
    }

    return this.prisma.attendance.update({
      where: {
        id,
      },
      data: {
        ...(dto.status !== undefined
          ? {
              status: dto.status,
            }
          : {}),
        ...(dto.note !== undefined
          ? {
              note: dto.note,
            }
          : {}),
      },
      include: {
        student: true,
        class: true,
        teacher: true,
      },
    });
  }

  async remove(
    id: string,
    user: RequestUser,
  ) {
    this.ensureCanManageAttendance(user);

    const schoolId =
      await this.getSchoolId(user);

    const attendance =
      await this.prisma.attendance.findFirst({
        where: {
          id,
          class: {
            schoolId,
          },
        },
        include: {
          class: true,
        },
      });

    if (!attendance) {
      throw new NotFoundException(
        'Attendance record not found',
      );
    }

    if (user.role === UserRole.TEACHER) {
      const teacher =
        await this.getTeacherForUser(
          user,
          schoolId,
        );

      await this.ensureTeacherCanAccessClass(
        teacher.id,
        attendance.classId,
      );
    }

    await this.prisma.attendance.delete({
      where: {
        id,
      },
    });

    return {
      message: 'Attendance deleted successfully',
    };
  }
}