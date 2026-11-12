import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  PromotionAction,
  ReportCardStatus,
  StudentStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';
import { StudentAccessService } from '../student-access/student-access.service';

import { ChangeClassDto, PromoteDto, PromotionPreviewQueryDto, TransferOutDto } from './dto/lifecycle.dto';
import {
  findFileDuplicates,
  readCsv,
  validateRow,
  type ImportRowError,
  type ParsedStudentRow,
} from './student-import.logic';

interface RowProblem {
  studentId: string;
  errors: string[];
}

@Injectable()
export class StudentLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StudentAccessService,
  ) {}

  private requireSchoolId(user: RequestUser): string {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    return user.schoolId;
  }

  // --------------------------------------------------
  // Promotion: preview
  // --------------------------------------------------

  async preview(query: PromotionPreviewQueryDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const passMark = query.passMark ?? 40;

    const fromClass = await this.prisma.schoolClass.findFirst({
      where: { id: query.fromClassId, schoolId },
      include: { classLevel: true },
    });

    if (!fromClass) {
      throw new NotFoundException('Class not found');
    }

    const toSession = await this.prisma.academicSession.findFirst({
      where: { id: query.toAcademicSessionId, schoolId },
      select: { id: true, name: true },
    });

    if (!toSession) {
      throw new NotFoundException('Academic session not found');
    }

    if (toSession.id === fromClass.academicSessionId) {
      throw new BadRequestException('Choose the NEW session to promote into');
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: { classId: fromClass.id, status: EnrollmentStatus.ACTIVE },
      select: { student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } } },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    });

    const studentIds = enrollments.map((e) => e.student.id);

    // The most recent published result decides the suggestion
    const cards = await this.prisma.reportCard.findMany({
      where: {
        schoolId,
        studentId: { in: studentIds },
        status: ReportCardStatus.PUBLISHED,
        examination: { classId: fromClass.id },
      },
      orderBy: { publishedAt: 'desc' },
      select: { studentId: true, average: true, position: true },
    });

    const latest = new Map<string, { average: number; position: number | null }>();

    for (const card of cards) {
      if (!latest.has(card.studentId)) {
        latest.set(card.studentId, { average: card.average, position: card.position });
      }
    }

    const level = fromClass.classLevel;
    const isFinal = !!level?.isFinal;

    const classesInNewSession = await this.prisma.schoolClass.findMany({
      where: { schoolId, academicSessionId: toSession.id },
      select: { id: true, name: true, capacity: true, levelId: true },
      orderBy: { name: 'asc' },
    });

    const nextTargets = level?.nextLevelId ? classesInNewSession.filter((c) => c.levelId === level.nextLevelId) : [];
    const repeatTargets = level ? classesInNewSession.filter((c) => c.levelId === level.id) : [];

    return {
      fromClass: { id: fromClass.id, name: fromClass.name, level: level?.name ?? null },
      toSession,
      isFinalLevel: isFinal,
      passMark,
      nextClasses: nextTargets,
      repeatClasses: repeatTargets,
      allClassesInNewSession: classesInNewSession,
      students: enrollments.map(({ student }) => {
        const result = latest.get(student.id);

        let suggestedAction: PromotionAction | null = null;

        if (result) {
          suggestedAction = isFinal
            ? PromotionAction.GRADUATED
            : result.average >= passMark
              ? PromotionAction.PROMOTED
              : PromotionAction.REPEATED;
        }

        return {
          studentId: student.id,
          name: `${student.firstName} ${student.lastName}`,
          admissionNumber: student.admissionNumber,
          average: result?.average ?? null,
          position: result?.position ?? null,
          suggestedAction,
        };
      }),
    };
  }

  // --------------------------------------------------
  // Promotion: do it (all or nothing)
  // --------------------------------------------------

  async promote(dto: PromoteDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    const toSession = await this.prisma.academicSession.findFirst({
      where: { id: dto.toAcademicSessionId, schoolId },
      select: { id: true },
    });

    if (!toSession) {
      throw new NotFoundException('Academic session not found');
    }

    const studentIds = dto.entries.map((e) => e.studentId);

    if (new Set(studentIds).size !== studentIds.length) {
      throw new BadRequestException('A student appears more than once in the list');
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId: { in: studentIds }, status: EnrollmentStatus.ACTIVE, class: { schoolId } },
      include: { class: { select: { id: true, name: true, academicSessionId: true } } },
    });

    const currentByStudent = new Map(enrollments.map((e) => [e.studentId, e]));

    const alreadyInNewSession = new Set(
      (
        await this.prisma.enrollment.findMany({
          where: { studentId: { in: studentIds }, academicSessionId: toSession.id },
          select: { studentId: true },
        })
      ).map((e) => e.studentId),
    );

    const targetIds = [...new Set(dto.entries.map((e) => e.toClassId).filter((id): id is string => !!id))];

    const targetClasses = await this.prisma.schoolClass.findMany({
      where: { id: { in: targetIds }, schoolId },
      select: { id: true, name: true, academicSessionId: true, capacity: true },
    });

    const targetById = new Map(targetClasses.map((c) => [c.id, c]));

    const occupied = await this.prisma.enrollment.groupBy({
      by: ['classId'],
      where: { classId: { in: targetIds }, status: EnrollmentStatus.ACTIVE },
      _count: { _all: true },
    });

    const filled = new Map(occupied.map((o) => [o.classId, o._count._all]));
    const incoming = new Map<string, number>();

    // ---- Check every row first. If any row is wrong, change nothing. ----
    const problems: RowProblem[] = [];

    for (const entry of dto.entries) {
      const errors: string[] = [];
      const current = currentByStudent.get(entry.studentId);

      if (!current) {
        errors.push('This student has no active enrollment in this school');
      } else if (current.class.academicSessionId === toSession.id) {
        errors.push('The student is already in that session. Use "change class" to move within a session.');
      }

      if (alreadyInNewSession.has(entry.studentId)) {
        errors.push('The student is already enrolled in the new session');
      }

      const needsClass = entry.action === 'PROMOTED' || entry.action === 'REPEATED';

      if (needsClass) {
        const target = entry.toClassId ? targetById.get(entry.toClassId) : undefined;

        if (!entry.toClassId) {
          errors.push('Choose the class to place the student in (toClassId)');
        } else if (!target) {
          errors.push('The chosen class was not found in this school');
        } else if (target.academicSessionId !== toSession.id) {
          errors.push('The chosen class does not belong to the new session');
        } else {
          const taken = (filled.get(target.id) ?? 0) + (incoming.get(target.id) ?? 0);

          if (target.capacity !== null && taken >= target.capacity) {
            errors.push(`${target.name} is full (capacity ${target.capacity})`);
          } else {
            incoming.set(target.id, (incoming.get(target.id) ?? 0) + 1);
          }
        }
      } else if (entry.toClassId) {
        errors.push('A class should not be given for graduating or transferring out');
      }

      if (errors.length > 0) {
        problems.push({ studentId: entry.studentId, errors });
      }
    }

    if (problems.length > 0) {
      throw new BadRequestException({ message: 'Some students cannot be processed. Nothing was changed.', errors: problems });
    }

    // ---- Do it, all or nothing ----
    const counts = { promoted: 0, repeated: 0, graduated: 0, transferredOut: 0 };

    await this.prisma.$transaction(
      async (tx) => {
        for (const entry of dto.entries) {
          const current = currentByStudent.get(entry.studentId)!;
          const target = entry.toClassId ? targetById.get(entry.toClassId) : undefined;

          await tx.enrollment.update({
            where: { id: current.id },
            data: {
              status: entry.action === 'TRANSFERRED_OUT' ? EnrollmentStatus.TRANSFERRED : EnrollmentStatus.COMPLETED,
            },
          });

          if (target) {
            await tx.enrollment.create({
              data: {
                studentId: entry.studentId,
                classId: target.id,
                academicSessionId: toSession.id,
                status: EnrollmentStatus.ACTIVE,
              },
            });
          }

          if (entry.action === 'GRADUATED') {
            await tx.student.update({ where: { id: entry.studentId }, data: { status: StudentStatus.GRADUATED } });
          } else if (entry.action === 'TRANSFERRED_OUT') {
            await tx.student.update({ where: { id: entry.studentId }, data: { status: StudentStatus.TRANSFERRED } });
          }

          await tx.promotion.create({
            data: {
              schoolId,
              studentId: entry.studentId,
              action: entry.action as PromotionAction,
              fromClassId: current.class.id,
              fromClassName: current.class.name,
              fromSessionId: current.class.academicSessionId,
              toClassId: target?.id ?? null,
              toClassName: target?.name ?? null,
              toSessionId: target ? toSession.id : null,
              note: entry.note?.trim() || null,
              performedById: user.id,
            },
          });

          if (entry.action === 'PROMOTED') counts.promoted++;
          else if (entry.action === 'REPEATED') counts.repeated++;
          else if (entry.action === 'GRADUATED') counts.graduated++;
          else counts.transferredOut++;
        }

        await tx.auditLog.create({
          data: {
            schoolId,
            userId: user.id,
            action: 'students.promoted',
            resource: 'AcademicSession',
            resourceId: toSession.id,
            metadata: counts,
          },
        });
      },
      { timeout: 60000 },
    );

    return { processed: dto.entries.length, ...counts };
  }

  // --------------------------------------------------
  // Move a student to another class in the SAME session
  // --------------------------------------------------

  async changeClass(studentId: string, dto: ChangeClassDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, status: EnrollmentStatus.ACTIVE, class: { schoolId } },
      include: { class: { select: { id: true, name: true, academicSessionId: true } } },
    });

    if (!enrollment) {
      throw new NotFoundException('This student has no active enrollment');
    }

    const target = await this.prisma.schoolClass.findFirst({
      where: { id: dto.toClassId, schoolId },
      select: { id: true, name: true, academicSessionId: true, capacity: true },
    });

    if (!target) {
      throw new NotFoundException('Class not found');
    }

    if (target.id === enrollment.class.id) {
      throw new BadRequestException('The student is already in that class');
    }

    if (target.academicSessionId !== enrollment.class.academicSessionId) {
      throw new BadRequestException('The new class must be in the same session. Use promotion to move to a new session.');
    }

    if (target.capacity !== null) {
      const filled = await this.prisma.enrollment.count({
        where: { classId: target.id, status: EnrollmentStatus.ACTIVE },
      });

      if (filled >= target.capacity) {
        throw new ConflictException(`${target.name} is full (capacity ${target.capacity})`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.enrollment.update({ where: { id: enrollment.id }, data: { classId: target.id } });

      const record = await tx.promotion.create({
        data: {
          schoolId,
          studentId,
          action: PromotionAction.CLASS_CHANGE,
          fromClassId: enrollment.class.id,
          fromClassName: enrollment.class.name,
          toClassId: target.id,
          toClassName: target.name,
          fromSessionId: enrollment.class.academicSessionId,
          toSessionId: target.academicSessionId,
          note: dto.reason.trim(),
          performedById: user.id,
        },
      });

      await tx.auditLog.create({
        data: { schoolId, userId: user.id, action: 'student.class_changed', resource: 'Student', resourceId: studentId },
      });

      return record;
    });
  }

  // --------------------------------------------------
  // A student leaves the school
  // --------------------------------------------------

  async transferOut(studentId: string, dto: TransferOutDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId },
      select: { id: true, status: true },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    if (student.status === StudentStatus.TRANSFERRED || student.status === StudentStatus.GRADUATED) {
      throw new ConflictException(`This student is already marked ${student.status}`);
    }

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, status: EnrollmentStatus.ACTIVE },
      include: { class: { select: { id: true, name: true, academicSessionId: true } } },
    });

    return this.prisma.$transaction(async (tx) => {
      if (enrollment) {
        await tx.enrollment.update({ where: { id: enrollment.id }, data: { status: EnrollmentStatus.TRANSFERRED } });
      }

      await tx.student.update({ where: { id: studentId }, data: { status: StudentStatus.TRANSFERRED } });

      const record = await tx.promotion.create({
        data: {
          schoolId,
          studentId,
          action: PromotionAction.TRANSFERRED_OUT,
          fromClassId: enrollment?.class.id ?? null,
          fromClassName: enrollment?.class.name ?? null,
          fromSessionId: enrollment?.class.academicSessionId ?? null,
          note: dto.reason.trim(),
          performedById: user.id,
        },
      });

      await tx.auditLog.create({
        data: { schoolId, userId: user.id, action: 'student.transferred_out', resource: 'Student', resourceId: studentId },
      });

      return record;
    });
  }

  // --------------------------------------------------
  // What has happened to a student over the years
  // --------------------------------------------------

  async history(studentId: string, user: RequestUser) {
    await this.access.assertCanView(user, studentId, [UserRole.SCHOOL_ADMIN, UserRole.TEACHER]);

    return this.prisma.promotion.findMany({
      where: { studentId, schoolId: user.schoolId! },
      select: {
        id: true,
        action: true,
        fromClassName: true,
        toClassName: true,
        note: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --------------------------------------------------
  // CSV import
  // --------------------------------------------------

  async importStudents(fileText: string, dryRun: boolean, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    const { rows: raw, missingColumns } = readCsv(fileText);

    if (missingColumns.length > 0) {
      throw new BadRequestException({
        message: `The file is missing required columns: ${missingColumns.join(', ')}`,
        errors: [{ row: 1, message: `Missing columns: ${missingColumns.join(', ')}` }],
      });
    }

    if (raw.length === 0) {
      throw new BadRequestException('The file has no students in it');
    }

    const errors: ImportRowError[] = [];
    const valid: ParsedStudentRow[] = [];

    raw.forEach((record, index) => {
      const result = validateRow(record, index + 2);

      if (result.value) {
        valid.push(result.value);
      } else {
        errors.push(...result.errors);
      }
    });

    errors.push(...findFileDuplicates(valid));

    // ---- Against what the school already has ----
    const existing = await this.prisma.student.findMany({
      where: {
        schoolId,
        OR: [
          { admissionNumber: { in: valid.map((r) => r.admissionNumber) } },
          { email: { in: valid.map((r) => r.email).filter((e): e is string => !!e) } },
        ],
      },
      select: { admissionNumber: true, email: true },
    });

    const takenAdmissions = new Set(existing.map((s) => s.admissionNumber.toLowerCase()));
    const takenEmails = new Set(existing.map((s) => s.email).filter((e): e is string => !!e));

    for (const r of valid) {
      if (takenAdmissions.has(r.admissionNumber.toLowerCase())) {
        errors.push({ row: r.row, field: 'admissionNumber', message: `Admission number ${r.admissionNumber} already exists in this school` });
      }

      if (r.email && takenEmails.has(r.email)) {
        errors.push({ row: r.row, field: 'email', message: `Email ${r.email} already belongs to a student in this school` });
      }
    }

    // ---- Classes, by name, in the active session ----
    const classNames = [...new Set(valid.map((r) => r.className).filter((n): n is string => !!n))];
    const classByName = new Map<string, { id: string; name: string; academicSessionId: string; capacity: number | null }>();

    if (classNames.length > 0) {
      const activeSession = await this.prisma.academicSession.findFirst({
        where: { schoolId, isActive: true },
        select: { id: true },
      });

      if (!activeSession) {
        errors.push({ row: 1, message: 'Classes were given but the school has no active academic session' });
      } else {
        const classes = await this.prisma.schoolClass.findMany({
          where: { schoolId, academicSessionId: activeSession.id, name: { in: classNames } },
          select: { id: true, name: true, academicSessionId: true, capacity: true },
        });

        classes.forEach((c) => classByName.set(c.name.toLowerCase(), c));

        const filled = await this.prisma.enrollment.groupBy({
          by: ['classId'],
          where: { classId: { in: classes.map((c) => c.id) }, status: EnrollmentStatus.ACTIVE },
          _count: { _all: true },
        });

        const taken = new Map(filled.map((f) => [f.classId, f._count._all]));
        const incoming = new Map<string, number>();

        for (const r of valid) {
          if (!r.className) continue;

          const cls = classByName.get(r.className.toLowerCase());

          if (!cls) {
            errors.push({ row: r.row, field: 'className', message: `No class called "${r.className}" in the active session` });
            continue;
          }

          const used = (taken.get(cls.id) ?? 0) + (incoming.get(cls.id) ?? 0);

          if (cls.capacity !== null && used >= cls.capacity) {
            errors.push({ row: r.row, field: 'className', message: `${cls.name} is full (capacity ${cls.capacity})` });
          } else {
            incoming.set(cls.id, (incoming.get(cls.id) ?? 0) + 1);
          }
        }
      }
    }

    // ---- Does the plan have room for this many students? ----
    const room = await this.roomForStudents(schoolId);

    if (room !== null && valid.length > room) {
      errors.push({
        row: 1,
        message: `Your plan has room for ${room} more student(s) but the file has ${valid.length}`,
      });
    }

    errors.sort((a, b) => a.row - b.row);

    const summary = { totalRows: raw.length, validRows: errors.length === 0 ? valid.length : 0, errorCount: errors.length };

    if (dryRun) {
      return { dryRun: true, ok: errors.length === 0, ...summary, errors };
    }

    if (errors.length > 0) {
      throw new BadRequestException({ message: 'The file has problems. Nothing was imported.', ...summary, errors });
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.student.createMany({
          data: valid.map((r) => ({
            schoolId,
            admissionNumber: r.admissionNumber,
            firstName: r.firstName,
            middleName: r.middleName,
            lastName: r.lastName,
            gender: r.gender,
            dateOfBirth: r.dateOfBirth,
            email: r.email,
            phone: r.phone,
            address: r.address,
          })),
        });

        const withClass = valid.filter((r) => r.className);

        if (withClass.length > 0) {
          const created = await tx.student.findMany({
            where: { schoolId, admissionNumber: { in: withClass.map((r) => r.admissionNumber) } },
            select: { id: true, admissionNumber: true },
          });

          const idByAdmission = new Map(created.map((s) => [s.admissionNumber, s.id]));

          await tx.enrollment.createMany({
            data: withClass.map((r) => {
              const cls = classByName.get(r.className!.toLowerCase())!;

              return {
                studentId: idByAdmission.get(r.admissionNumber)!,
                classId: cls.id,
                academicSessionId: cls.academicSessionId,
                status: EnrollmentStatus.ACTIVE,
              };
            }),
          });
        }

        await tx.auditLog.create({
          data: {
            schoolId,
            userId: user.id,
            action: 'students.imported',
            resource: 'School',
            resourceId: schoolId,
            metadata: { students: valid.length, enrolled: valid.filter((r) => r.className).length },
          },
        });
      },
      { timeout: 60000 },
    );

    return { dryRun: false, ok: true, imported: valid.length, enrolled: valid.filter((r) => r.className).length };
  }

  // null = no limit
  private async roomForStudents(schoolId: string): Promise<number | null> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { schoolId },
      include: { plan: true },
    });

    const limit = subscription?.plan.maxStudents ?? null;

    if (limit === null) {
      return null;
    }

    const count = await this.prisma.student.count({
      where: { schoolId, status: { notIn: [StudentStatus.GRADUATED, StudentStatus.TRANSFERRED] } },
    });

    return Math.max(0, limit - count);
  }
}

