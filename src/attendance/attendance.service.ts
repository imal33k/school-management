import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import {
  AttendanceStatus,
  EnrollmentStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';
import { BulkAttendanceDto } from './dto/bulk-attendance.dto';
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

  // Bulk attendance (mark a whole class in one go)

  async bulkMark(dto: BulkAttendanceDto, user: RequestUser) {
    this.ensureCanManageAttendance(user);

    const schoolId = await this.getSchoolId(user);
    const date = this.normalizeDate(dto.date);

    const schoolClass = await this.prisma.schoolClass.findFirst({
      where:{ id:dto.classId, schoolId },
      include: { academicSession: true}
    });

    if (!schoolClass){
      throw new NotFoundException('Class not found')
    }

    if (
      date < schoolClass.academicSession.startDate ||
      date > schoolClass.academicSession.endDate
    ) {
      throw new ConflictException('Attendance date is outside the academic session')
    }
    
    // 2. A teacher can only mark a class they are assigned to
    let teacherId: string | undefined;

    if (user.role == UserRole.TEACHER){
      const teacher = await this.getTeacherForUser(user, schoolId);
      await this.ensureTeacherCanAccessClass(teacher.id, schoolClass.id);
      teacherId = teacher.id;
    }

    // no student should appear twice
    const studentIds = dto.records.map((record) => record.studentId);
    if (new Set (studentIds).size !== studentIds.length) {
      throw new BadRequestException(
        'A student appears more than once in the lsit',
      );
    }
     // 4. Every student must be actively enrolled in this class
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        classId: schoolClass.id,
        status: EnrollmentStatus.ACTIVE,
        studentId: { in: studentIds },
      },
      select: { studentId: true },
    });

    const enrolledIds = new Set(enrollments.map((e) => e.studentId));
    const notInClass = studentIds.filter((id) => !enrolledIds.has(id));

    if (notInClass.length > 0) {
      throw new BadRequestException(
        `These students are not actively enrolled in this class: ${notInClass.join(', ')}`,
      );
    }

    // 5. Save everything, or nothing. upsert = update if it exists, otherwise create.
    await this.prisma.$transaction(
      dto.records.map((record) =>
        this.prisma.attendance.upsert({
          where: {
            studentId_date: { studentId: record.studentId, date },
          },
          create: {
            studentId: record.studentId,
            classId: schoolClass.id,
            teacherId,
            date,
            status: record.status,
            note: record.note,
          },
          update: {
            classId: schoolClass.id,
            teacherId,
            status: record.status,
            note: record.note ?? null,
          },
        }),
      ),
    );

    // 6. Reply with a short summary
    const counts: Record<string, number> = {};
    for (const record of dto.records) {
      counts[record.status] = (counts[record.status] ?? 0) + 1;
    }

    return {
      classId: schoolClass.id,
      date: dto.date,
      saved: dto.records.length,
      counts,
    };
  }
  
    // --------------------------------------------------
  // ROSTER (the class list for one day, with any marks already saved)
  // --------------------------------------------------

  async getRoster(classId: string, date: string, user: RequestUser) {
    this.ensureCanManageAttendance(user);

    const schoolId = await this.getSchoolId(user);
    const day = this.normalizeDate(date);

    const schoolClass = await this.prisma.schoolClass.findFirst({
      where: { id: classId, schoolId },
    });

    if (!schoolClass) {
      throw new NotFoundException('Class not found');
    }

    // A teacher can only open a class they are assigned to
    if (user.role === UserRole.TEACHER) {
      const teacher = await this.getTeacherForUser(user, schoolId);
      await this.ensureTeacherCanAccessClass(teacher.id, schoolClass.id);
    }

    // Everyone actively enrolled in the class, sorted by name
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classId: schoolClass.id, status: EnrollmentStatus.ACTIVE },
      select: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: [
        { student: { lastName: 'asc' } },
        { student: { firstName: 'asc' } },
      ],
    });

    // Marks already saved for that day
    const studentIds = enrollments.map((e) => e.student.id);

    const marks = await this.prisma.attendance.findMany({
      where: { date: day, studentId: { in: studentIds } },
      select: { studentId: true, status: true, note: true },
    });

    const markByStudent = new Map(marks.map((m) => [m.studentId, m]));

    // Join them: every student appears, with status null if not marked yet
    const students = enrollments.map(({ student }) => {
      const mark = markByStudent.get(student.id);

      return {
        studentId: student.id,
        admissionNumber: student.admissionNumber,
        firstName: student.firstName,
        lastName: student.lastName,
        status: mark?.status ?? null,
        note: mark?.note ?? null,
      };
    });

    return {
      classId: schoolClass.id,
      date,
      total: students.length,
      marked: marks.length,
      students,
    };
  }

    // --------------------------------------------------
  // SUMMARY (counts per student between two dates)
  // --------------------------------------------------

  async getClassSummary(
    classId: string,
    from: string,
    to: string,
    user: RequestUser,
  ) {
    this.ensureCanManageAttendance(user);

    const schoolId = await this.getSchoolId(user);
    const start = this.normalizeDate(from);
    const end = this.normalizeDate(to);

    if (start > end) {
      throw new BadRequestException('"from" must not be after "to"');
    }

    const days = (end.getTime() - start.getTime()) / 86_400_000;

    if (days > 366) {
      throw new BadRequestException(
        'The date range cannot be longer than one year',
      );
    }

    const schoolClass = await this.prisma.schoolClass.findFirst({
      where: { id: classId, schoolId },
    });

    if (!schoolClass) {
      throw new NotFoundException('Class not found');
    }

    // A teacher can only open a class they are assigned to
    if (user.role === UserRole.TEACHER) {
      const teacher = await this.getTeacherForUser(user, schoolId);
      await this.ensureTeacherCanAccessClass(teacher.id, schoolClass.id);
    }

    // Everyone actively enrolled in the class, sorted by name
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classId: schoolClass.id, status: EnrollmentStatus.ACTIVE },
      select: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: [
        { student: { lastName: 'asc' } },
        { student: { firstName: 'asc' } },
      ],
    });

    const studentIds = enrollments.map((e) => e.student.id);
    const inRange = { gte: start, lte: end };

    // Let the database count: one row per student + status
    const grouped = await this.prisma.attendance.groupBy({
      by: ['studentId', 'status'],
      where: {
        classId: schoolClass.id,
        studentId: { in: studentIds },
        date: inRange,
      },
      _count: { _all: true },
    });

    // "Days opened" = days when the class register was taken at least once
    const openDays = await this.prisma.attendance.findMany({
      where: { classId: schoolClass.id, date: inRange },
      distinct: ['date'],
      select: { date: true },
    });

    const countsByStudent = new Map<string, Record<string, number>>();

    for (const row of grouped) {
      const counts = countsByStudent.get(row.studentId) ?? {};
      counts[row.status] = row._count._all;
      countsByStudent.set(row.studentId, counts);
    }

    const students = enrollments.map(({ student }) => {
      const counts = countsByStudent.get(student.id) ?? {};
      const present = counts[AttendanceStatus.PRESENT] ?? 0;
      const late = counts[AttendanceStatus.LATE] ?? 0;
      const absent = counts[AttendanceStatus.ABSENT] ?? 0;
      const excused = counts[AttendanceStatus.EXCUSED] ?? 0;
      const marked = present + late + absent + excused;

      return {
        studentId: student.id,
        admissionNumber: student.admissionNumber,
        firstName: student.firstName,
        lastName: student.lastName,
        present,
        late,
        absent,
        excused,
        marked,
        // % of marked days the student was there (present or late)
        rate: marked === 0 ? null : Math.round(((present + late) / marked) * 100),
      };
    });

    return {
      classId: schoolClass.id,
      from,
      to,
      daysOpened: openDays.length,
      students,
    };
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