import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceStatus,
  EnrollmentStatus,
  ExaminationStatus,
  ReportCardStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';
import { AssessmentComponentsService } from '../assessment-components/assessment-components.service';
import { GradingService } from '../grading/grading.service';
import { gradeFor, percentageOf, roundTo2 } from '../grading/grading.logic';

import {
  GenerateReportCardsDto,
  PublishReportCardsDto,
  UpdateRemarksDto,
} from './dto/report-card.dto';
import { rankDescending, summarizeStudent } from './ranking.logic';
import { renderReportCardsPdf } from './report-card-pdf';
import type { ReportCardView } from './report-card.types';

interface CardRow {
  studentId: string;
  totalScore: number;
  average: number;
  position: number | null;
  classSize: number;
  subjectCount: number;
}

@Injectable()
export class ReportCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gradingService: GradingService,
    private readonly componentsService: AssessmentComponentsService,
  ) {}

  // --------------------------------------------------
  // Small helpers
  // --------------------------------------------------

  private requireSchoolId(user: RequestUser): string {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    return user.schoolId;
  }

  private requireAdmin(user: RequestUser) {
    if (user.role !== UserRole.SCHOOL_ADMIN) {
      throw new ForbiddenException('Only a school admin can do this');
    }
  }

  private async getExam(examinationId: string, schoolId: string) {
    const exam = await this.prisma.examination.findFirst({
      where: { id: examinationId, schoolId },
      include: {
        class: { select: { id: true, name: true } },
        term: { select: { id: true, name: true, startDate: true, endDate: true } },
        session: { select: { id: true, name: true } },
      },
    });

    if (!exam) {
      throw new NotFoundException('Examination not found in this school');
    }

    return exam;
  }

  // Admins may see any class. Teachers only the classes they are assigned to.
  private async assertStaffClassAccess(
    user: RequestUser,
    classId: string,
    schoolId: string,
  ) {
    if (user.role === UserRole.SCHOOL_ADMIN) {
      return;
    }

    if (user.role !== UserRole.TEACHER) {
      throw new ForbiddenException('You are not allowed to do this');
    }

    const teacher = await this.prisma.teacher.findFirst({
      where: { userId: user.id, schoolId },
    });

    if (!teacher) {
      throw new NotFoundException('Teacher profile not found');
    }

    const assignment = await this.prisma.classTeacher.findUnique({
      where: { classId_teacherId: { classId, teacherId: teacher.id } },
    });

    if (!assignment) {
      throw new ForbiddenException('You are not assigned to this class');
    }
  }

  // Report cards can be prepared once marking is finished
  private assertReadyForCards(status: ExaminationStatus) {
    if (
      status !== ExaminationStatus.COMPLETED &&
      status !== ExaminationStatus.PUBLISHED
    ) {
      throw new ConflictException(
        'Close the examination (set it to COMPLETED) before preparing report cards',
      );
    }
  }

  private async assertNotPublished(examinationId: string) {
    const published = await this.prisma.reportCard.count({
      where: { examinationId, status: ReportCardStatus.PUBLISHED },
    });

    if (published > 0) {
      throw new ConflictException('These report cards are already published');
    }
  }

  // --------------------------------------------------
  // The maths: totals, averages and positions for a whole class
  // --------------------------------------------------

  private async computeRows(exam: { id: string; classId: string }) {
    const examSubjects = await this.prisma.examinationSubject.findMany({
      where: { examinationId: exam.id },
      select: { subjectId: true, maxScore: true },
    });

    const maxBySubject = new Map(examSubjects.map((s) => [s.subjectId, s.maxScore]));

    const enrollments = await this.prisma.enrollment.findMany({
      where: { classId: exam.classId, status: EnrollmentStatus.ACTIVE },
      select: { studentId: true },
    });

    const studentIds = enrollments.map((e) => e.studentId);

    const results = await this.prisma.result.findMany({
      where: { examinationId: exam.id, studentId: { in: studentIds } },
      select: { studentId: true, subjectId: true, totalScore: true },
    });

    const marksByStudent = new Map<string, { totalScore: number; maxScore: number }[]>();

    for (const result of results) {
      const maxScore = maxBySubject.get(result.subjectId);

      if (maxScore === undefined) {
        continue; // a result for a subject that is no longer in this exam
      }

      const marks = marksByStudent.get(result.studentId) ?? [];
      marks.push({ totalScore: result.totalScore, maxScore });
      marksByStudent.set(result.studentId, marks);
    }

    const summaries = studentIds.map((studentId) => ({
      studentId,
      ...summarizeStudent(marksByStudent.get(studentId) ?? []),
    }));

    // Only students who have at least one result get a position
    const ranks = rankDescending(
      summaries
        .filter((s) => s.subjectCount > 0)
        .map((s) => ({ id: s.studentId, value: s.average })),
    );

    const rows: CardRow[] = summaries.map((s) => ({
      studentId: s.studentId,
      totalScore: s.totalScore,
      average: s.average,
      position: ranks.get(s.studentId) ?? null,
      classSize: studentIds.length,
      subjectCount: s.subjectCount,
    }));

    return { rows, classSize: studentIds.length };
  }

  private async saveRows(
    tx: any,
    schoolId: string,
    examinationId: string,
    rows: CardRow[],
  ) {
    for (const row of rows) {
      const figures = {
        totalScore: row.totalScore,
        average: row.average,
        position: row.position,
        classSize: row.classSize,
        subjectCount: row.subjectCount,
      };

      // update only touches the figures, so remarks and status are never lost
      await tx.reportCard.upsert({
        where: {
          studentId_examinationId: { studentId: row.studentId, examinationId },
        },
        create: { schoolId, studentId: row.studentId, examinationId, ...figures },
        update: { ...figures, generatedAt: new Date() },
      });
    }
  }

  // --------------------------------------------------
  // Generate (or refresh) the draft report cards for an exam
  // --------------------------------------------------

  async generate(dto: GenerateReportCardsDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    this.requireAdmin(user);

    const exam = await this.getExam(dto.examinationId, schoolId);

    this.assertReadyForCards(exam.status);
    await this.assertNotPublished(exam.id);

    const { rows, classSize } = await this.computeRows(exam);

    if (classSize === 0) {
      throw new ConflictException('No students are enrolled in this class');
    }

    await this.prisma.$transaction(
      async (tx) => {
        await this.saveRows(tx, schoolId, exam.id, rows);

        await tx.auditLog.create({
          data: {
            schoolId,
            userId: user.id,
            action: 'report_cards.generated',
            resource: 'Examination',
            resourceId: exam.id,
            metadata: { students: rows.length },
          },
        });
      },
      { timeout: 30000 },
    );

    return {
      examinationId: exam.id,
      generated: rows.length,
      classSize,
      ranked: rows.filter((r) => r.position !== null).length,
    };
  }

  // --------------------------------------------------
  // Publish: lock the results and make the cards visible to families
  // --------------------------------------------------

  async publish(dto: PublishReportCardsDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    this.requireAdmin(user);

    const exam = await this.getExam(dto.examinationId, schoolId);

    this.assertReadyForCards(exam.status);
    await this.assertNotPublished(exam.id);

    const drafts = await this.prisma.reportCard.count({
      where: { examinationId: exam.id },
    });

    if (drafts === 0) {
      throw new ConflictException('Generate the report cards first');
    }

    // ---- Is every student's result complete for every subject? ----
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classId: exam.classId, status: EnrollmentStatus.ACTIVE },
      select: { student: { select: { id: true, firstName: true, lastName: true } } },
    });

    const examSubjects = await this.prisma.examinationSubject.findMany({
      where: { examinationId: exam.id },
      select: { subjectId: true, subject: { select: { name: true } } },
    });

    const results = await this.prisma.result.findMany({
      where: {
        examinationId: exam.id,
        studentId: { in: enrollments.map((e) => e.student.id) },
      },
      select: { studentId: true, subjectId: true, grade: true },
    });

    const done = new Set(
      results.filter((r) => r.grade !== null).map((r) => `${r.studentId}|${r.subjectId}`),
    );
    const started = new Set(results.map((r) => `${r.studentId}|${r.subjectId}`));

    const missing: { student: string; subject: string; reason: string }[] = [];

    for (const { student } of enrollments) {
      for (const examSubject of examSubjects) {
        const key = `${student.id}|${examSubject.subjectId}`;

        if (!done.has(key)) {
          missing.push({
            student: `${student.firstName} ${student.lastName}`,
            subject: examSubject.subject.name,
            reason: started.has(key) ? 'incomplete marks' : 'no result',
          });
        }
      }
    }

    if (missing.length > 0 && !dto.force) {
      throw new ConflictException({
        message:
          'Some results are missing or incomplete. Fix them, or publish with force: true.',
        totalMissing: missing.length,
        missing: missing.slice(0, 50),
      });
    }

    // ---- Refresh the figures, lock the exam, publish the cards: all or nothing ----
    const { rows } = await this.computeRows(exam);
    const now = new Date();

    await this.prisma.$transaction(
      async (tx) => {
        await this.saveRows(tx, schoolId, exam.id, rows);

        if (exam.status !== ExaminationStatus.PUBLISHED) {
          await tx.examination.update({
            where: { id: exam.id },
            data: { status: ExaminationStatus.PUBLISHED },
          });
        }

        await tx.reportCard.updateMany({
          where: { examinationId: exam.id },
          data: { status: ReportCardStatus.PUBLISHED, publishedAt: now },
        });

        await tx.auditLog.create({
          data: {
            schoolId,
            userId: user.id,
            action: 'report_cards.published',
            resource: 'Examination',
            resourceId: exam.id,
            metadata: { students: rows.length, forced: !!dto.force, missing: missing.length },
          },
        });
      },
      { timeout: 30000 },
    );

    return {
      examinationId: exam.id,
      published: rows.length,
      missing: missing.length,
    };
  }

  // --------------------------------------------------
  // Remarks (class teacher and principal)
  // --------------------------------------------------

  async updateRemarks(id: string, dto: UpdateRemarksDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    const card = await this.prisma.reportCard.findFirst({
      where: { id, schoolId },
      include: { examination: { select: { classId: true } } },
    });

    if (!card) {
      throw new NotFoundException('Report card not found');
    }

    if (card.status === ReportCardStatus.PUBLISHED) {
      throw new ConflictException('Published report cards cannot be changed');
    }

    if (user.role === UserRole.TEACHER) {
      const teacher = await this.prisma.teacher.findFirst({
        where: { userId: user.id, schoolId },
      });

      const assignment = teacher
        ? await this.prisma.classTeacher.findUnique({
            where: {
              classId_teacherId: {
                classId: card.examination.classId,
                teacherId: teacher.id,
              },
            },
          })
        : null;

      if (!assignment || !assignment.isPrimary) {
        throw new ForbiddenException(
          "Only the class teacher can write this class's remarks",
        );
      }

      if (dto.principalRemark !== undefined) {
        throw new ForbiddenException(
          'Only a school admin can write the principal remark',
        );
      }
    } else if (user.role !== UserRole.SCHOOL_ADMIN) {
      throw new ForbiddenException('You are not allowed to do this');
    }

    const clean = (value?: string) =>
      value === undefined ? undefined : value.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reportCard.update({
        where: { id },
        data: {
          teacherRemark: clean(dto.teacherRemark),
          principalRemark: clean(dto.principalRemark),
        },
        select: { id: true, teacherRemark: true, principalRemark: true },
      });

      await tx.auditLog.create({
        data: {
          schoolId,
          userId: user.id,
          action: 'report_card.remarks_updated',
          resource: 'ReportCard',
          resourceId: id,
        },
      });

      return updated;
    });
  }

  // --------------------------------------------------
  // Lists
  // --------------------------------------------------

  async listForExamination(examinationId: string, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const exam = await this.getExam(examinationId, schoolId);

    await this.assertStaffClassAccess(user, exam.classId, schoolId);

    const cards = await this.prisma.reportCard.findMany({
      where: { examinationId: exam.id, schoolId },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
      },
      orderBy: [{ position: { sort: 'asc', nulls: 'last' } }, { student: { lastName: 'asc' } }],
    });

    return {
      examination: {
        id: exam.id,
        name: exam.name,
        status: exam.status,
        className: exam.class.name,
        term: exam.term.name,
        session: exam.session.name,
      },
      cards: cards.map((card) => ({
        id: card.id,
        status: card.status,
        student: card.student,
        totalScore: card.totalScore,
        average: card.average,
        position: card.position,
        classSize: card.classSize,
        subjectCount: card.subjectCount,
        hasTeacherRemark: !!card.teacherRemark,
        hasPrincipalRemark: !!card.principalRemark,
      })),
    };
  }

  // A student sees their own, a parent sees their children's. Published only.
  async findMine(user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const studentIds = await this.familyStudentIds(user, schoolId);

    const cards = await this.prisma.reportCard.findMany({
      where: { schoolId, studentId: { in: studentIds }, status: ReportCardStatus.PUBLISHED },
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        examination: {
          select: {
            id: true,
            name: true,
            class: { select: { name: true } },
            term: { select: { name: true } },
            session: { select: { name: true } },
          },
        },
      },
      orderBy: { publishedAt: 'desc' },
    });

    return cards.map((card) => ({
      id: card.id,
      student: card.student,
      examination: card.examination.name,
      className: card.examination.class.name,
      term: card.examination.term.name,
      session: card.examination.session.name,
      average: card.average,
      position: card.position,
      classSize: card.classSize,
      publishedAt: card.publishedAt,
    }));
  }

  private async familyStudentIds(user: RequestUser, schoolId: string): Promise<string[]> {
    if (user.role === UserRole.STUDENT) {
      const student = await this.prisma.student.findFirst({
        where: { userId: user.id, schoolId },
        select: { id: true },
      });

      return student ? [student.id] : [];
    }

    if (user.role === UserRole.PARENT) {
      const parent = await this.prisma.parent.findFirst({
        where: { userId: user.id, schoolId },
        select: { children: { select: { studentId: true } } },
      });

      return parent ? parent.children.map((c) => c.studentId) : [];
    }

    throw new ForbiddenException('You are not allowed to do this');
  }

  // --------------------------------------------------
  // One card, and the PDFs
  // --------------------------------------------------

  private async loadCardForViewer(id: string, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    const card = await this.prisma.reportCard.findFirst({
      where: { id, schoolId },
      include: { examination: { select: { classId: true } } },
    });

    if (!card) {
      throw new NotFoundException('Report card not found');
    }

    if (user.role === UserRole.STUDENT || user.role === UserRole.PARENT) {
      const mine = await this.familyStudentIds(user, schoolId);

      // Not theirs, or not published yet: pretend it does not exist
      if (!mine.includes(card.studentId) || card.status !== ReportCardStatus.PUBLISHED) {
        throw new NotFoundException('Report card not found');
      }
    } else {
      await this.assertStaffClassAccess(user, card.examination.classId, schoolId);
    }

    return { card, schoolId };
  }

  async findOne(id: string, user: RequestUser) {
    const { card, schoolId } = await this.loadCardForViewer(id, user);
    const [view] = await this.loadViews(schoolId, card.examinationId, card.id);

    return view;
  }

  async getCardPdf(id: string, user: RequestUser) {
    const view = await this.findOne(id, user);
    const buffer = await renderReportCardsPdf([view]);

    return {
      buffer,
      filename: this.safeName(`report-card-${view.student.lastName}-${view.student.firstName}`),
    };
  }

  async getClassPdf(examinationId: string, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const exam = await this.getExam(examinationId, schoolId);

    await this.assertStaffClassAccess(user, exam.classId, schoolId);

    const views = await this.loadViews(schoolId, exam.id);

    if (views.length === 0) {
      throw new ConflictException('Generate the report cards first');
    }

    return {
      buffer: await renderReportCardsPdf(views),
      filename: this.safeName(`report-cards-${exam.class.name}-${exam.name}`),
    };
  }

  private safeName(name: string) {
    return name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').slice(0, 80) + '.pdf';
  }

  // --------------------------------------------------
  // Build the full report card pictures (shared by JSON and PDF)
  // --------------------------------------------------

  private async loadViews(
    schoolId: string,
    examinationId: string,
    onlyCardId?: string,
  ): Promise<ReportCardView[]> {
    const exam = await this.getExam(examinationId, schoolId);

    const cards = await this.prisma.reportCard.findMany({
      where: { examinationId, schoolId, ...(onlyCardId ? { id: onlyCardId } : {}) },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
      },
      orderBy: [{ position: { sort: 'asc', nulls: 'last' } }, { student: { lastName: 'asc' } }],
    });

    if (cards.length === 0) {
      return [];
    }

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true, address: true, phone: true, email: true, logoUrl: true },
    });

    const examSubjects = await this.prisma.examinationSubject.findMany({
      where: { examinationId },
      include: { subject: { select: { id: true, name: true } } },
      orderBy: { subject: { name: 'asc' } },
    });

    const components = await this.componentsService.getActiveComponents(schoolId);
    const { bands } = await this.gradingService.getEffectiveBands(schoolId);

    // Every result in the exam: needed for each student's marks AND for subject positions
    const results = await this.prisma.result.findMany({
      where: { examinationId },
      include: { componentScores: true },
    });

    const resultsBySubject = new Map<string, typeof results>();

    for (const result of results) {
      const list = resultsBySubject.get(result.subjectId) ?? [];
      list.push(result);
      resultsBySubject.set(result.subjectId, list);
    }

    const subjectRanks = new Map<string, Map<string, number>>();

    for (const [subjectId, list] of resultsBySubject) {
      subjectRanks.set(
        subjectId,
        rankDescending(list.map((r) => ({ id: r.studentId, value: r.totalScore }))),
      );
    }

    // Attendance for the term, counted once for everyone
    const studentIds = cards.map((c) => c.studentId);
    const range = { gte: exam.term.startDate, lte: exam.term.endDate };

    const attendanceCounts = await this.prisma.attendance.groupBy({
      by: ['studentId', 'status'],
      where: { classId: exam.classId, studentId: { in: studentIds }, date: range },
      _count: { _all: true },
    });

    const openDays = await this.prisma.attendance.findMany({
      where: { classId: exam.classId, date: range },
      distinct: ['date'],
      select: { date: true },
    });

    const gradeKey = [...bands]
      .sort((a, b) => b.minScore - a.minScore)
      .map((band) => ({ grade: band.grade, minScore: band.minScore, remark: band.remark ?? null }));

    return cards.map((card) => {
      const mine = results.filter((r) => r.studentId === card.studentId);

      const subjects = examSubjects
        .map((examSubject) => {
          const result = mine.find((r) => r.subjectId === examSubject.subjectId);

          if (!result) {
            return null;
          }

          const scores: Record<string, number> = {};

          for (const item of result.componentScores) {
            scores[item.componentId] = item.score;
          }

          return {
            subjectId: examSubject.subjectId,
            subject: examSubject.subject.name,
            scores,
            totalScore: result.totalScore,
            maxScore: examSubject.maxScore,
            grade: result.grade,
            remark: result.remark,
            position: subjectRanks.get(examSubject.subjectId)?.get(card.studentId) ?? null,
            outOf: resultsBySubject.get(examSubject.subjectId)?.length ?? 0,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      const counts: Record<string, number> = {};

      for (const row of attendanceCounts) {
        if (row.studentId === card.studentId) {
          counts[row.status] = row._count._all;
        }
      }

      const overall =
        card.subjectCount > 0 ? gradeFor(bands, percentageOf(card.average, 100)).grade : null;

      return {
        id: card.id,
        status: card.status,
        publishedAt: card.publishedAt,
        school: school ?? { name: '', address: null, phone: null, email: null, logoUrl: null },
        student: card.student,
        class: { id: exam.class.id, name: exam.class.name },
        term: { name: exam.term.name },
        session: { name: exam.session.name },
        examination: { id: exam.id, name: exam.name },
        components: components.map((c) => ({
          id: c.id,
          name: c.name,
          maxScore: c.maxScore,
          isExam: c.isExam,
        })),
        subjects,
        summary: {
          totalScore: roundTo2(card.totalScore),
          average: card.average,
          position: card.position,
          classSize: card.classSize,
          subjectCount: card.subjectCount,
          overallGrade: overall,
        },
        attendance: {
          daysOpened: openDays.length,
          present: (counts[AttendanceStatus.PRESENT] ?? 0) + (counts[AttendanceStatus.LATE] ?? 0),
          absent: counts[AttendanceStatus.ABSENT] ?? 0,
          excused: counts[AttendanceStatus.EXCUSED] ?? 0,
        },
        teacherRemark: card.teacherRemark,
        principalRemark: card.principalRemark,
        gradeKey,
      };
    });
  }
}
