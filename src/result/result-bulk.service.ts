import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, ExaminationStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';
import { AssessmentComponentsService } from '../assessment-components/assessment-components.service';
import { GradingService } from '../grading/grading.service';
import { gradeFor, percentageOf, roundTo2 } from '../grading/grading.logic';

import { BulkResultDto, ResultSheetQueryDto } from './dto/bulk-result.dto';
import {
  componentTotal,
  mergeScores,
  summarizeScores,
  validateEntryScores,
  type ScoreMap,
} from './result-scores.logic';

@Injectable()
export class ResultBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gradingService: GradingService,
    private readonly componentsService: AssessmentComponentsService,
  ) {}

  // --------------------------------------------------
  // Shared checks: who is asking, which exam, which subject
  // --------------------------------------------------

  private async loadContext(
    examinationId: string,
    subjectId: string,
    user: RequestUser,
  ) {
    if (user.role !== UserRole.SCHOOL_ADMIN && user.role !== UserRole.TEACHER) {
      throw new ForbiddenException('You are not allowed to enter results');
    }

    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    const schoolId = user.schoolId;

    const examination = await this.prisma.examination.findFirst({
      where: { id: examinationId, schoolId },
      include: { class: { select: { id: true, name: true } } },
    });

    if (!examination) {
      throw new NotFoundException('Examination not found in this school');
    }

    const examSubject = await this.prisma.examinationSubject.findUnique({
      where: { examinationId_subjectId: { examinationId, subjectId } },
      include: { subject: { select: { id: true, name: true } } },
    });

    if (!examSubject) {
      throw new NotFoundException('This subject is not part of the examination');
    }

    // A teacher must be assigned to the class AND to the subject
    let teacherId: string | undefined;

    if (user.role === UserRole.TEACHER) {
      const teacher = await this.prisma.teacher.findFirst({
        where: { userId: user.id, schoolId },
      });

      if (!teacher) {
        throw new NotFoundException('Teacher profile not found');
      }

      const classAssignment = await this.prisma.classTeacher.findUnique({
        where: {
          classId_teacherId: {
            classId: examination.classId,
            teacherId: teacher.id,
          },
        },
      });

      if (!classAssignment) {
        throw new ForbiddenException('You are not assigned to this class');
      }

      const subjectAssignment = await this.prisma.teacherSubject.findUnique({
        where: { teacherId_subjectId: { teacherId: teacher.id, subjectId } },
      });

      if (!subjectAssignment) {
        throw new ForbiddenException('You are not assigned to this subject');
      }

      teacherId = teacher.id;
    }

    return { schoolId, examination, examSubject, teacherId };
  }

  private async getActiveComponentsOrFail(schoolId: string) {
    const components = await this.componentsService.getActiveComponents(schoolId);

    if (components.length === 0) {
      throw new ConflictException(
        'Set up assessment components first (POST /assessment-components/defaults)',
      );
    }

    return components;
  }

  // --------------------------------------------------
  // GET the score sheet: the class list with any marks already saved
  // --------------------------------------------------

  async getSheet(query: ResultSheetQueryDto, user: RequestUser) {
    const { schoolId, examination, examSubject } = await this.loadContext(
      query.examinationId,
      query.subjectId,
      user,
    );

    const components = await this.componentsService.getActiveComponents(schoolId);

    const enrollments = await this.prisma.enrollment.findMany({
      where: { classId: examination.classId, status: EnrollmentStatus.ACTIVE },
      select: {
        student: {
          select: { id: true, admissionNumber: true, firstName: true, lastName: true },
        },
      },
      orderBy: [
        { student: { lastName: 'asc' } },
        { student: { firstName: 'asc' } },
      ],
    });

    const studentIds = enrollments.map((e) => e.student.id);

    const results = await this.prisma.result.findMany({
      where: {
        examinationId: examination.id,
        subjectId: query.subjectId,
        studentId: { in: studentIds },
      },
      include: { componentScores: true },
    });

    const byStudent = new Map(results.map((r) => [r.studentId, r]));

    const students = enrollments.map(({ student }) => {
      const result = byStudent.get(student.id);
      const scores: ScoreMap = {};

      for (const item of result?.componentScores ?? []) {
        scores[item.componentId] = item.score;
      }

      // Entered the old way (before components existed): show the old totals
      const legacy =
        !!result &&
        result.componentScores.length === 0 &&
        (result.caScore != null || result.examScore != null);

      const summary = summarizeScores(components, scores);

      return {
        studentId: student.id,
        admissionNumber: student.admissionNumber,
        firstName: student.firstName,
        lastName: student.lastName,
        resultId: result?.id ?? null,
        scores,
        totalScore: legacy ? (result?.totalScore ?? null) : result ? summary.totalScore : null,
        grade: result?.grade ?? null,
        remark: result?.remark ?? null,
        complete: legacy ? true : result ? summary.complete : false,
        legacy,
      };
    });

    const total = componentTotal(components);

    return {
      examination: {
        id: examination.id,
        name: examination.name,
        status: examination.status,
        classId: examination.classId,
        className: examination.class.name,
      },
      subject: { id: examSubject.subject.id, name: examSubject.subject.name },
      maxScore: examSubject.maxScore,
      components: components.map((c) => ({
        id: c.id,
        name: c.name,
        maxScore: c.maxScore,
        isExam: c.isExam,
      })),
      componentTotal: total,
      // If false, scores cannot be saved until the two numbers agree
      componentsMatchMaxScore: Math.abs(total - examSubject.maxScore) < 0.005,
      students,
    };
  }

  // --------------------------------------------------
  // PUT bulk: save a whole class's marks in one go
  // --------------------------------------------------

  async saveBulk(dto: BulkResultDto, user: RequestUser) {
    const { schoolId, examination, examSubject, teacherId } =
      await this.loadContext(dto.examinationId, dto.subjectId, user);

    if (examination.status !== ExaminationStatus.OPEN) {
      throw new ConflictException(
        'Results can only be entered for an open examination',
      );
    }

    const components = await this.getActiveComponentsOrFail(schoolId);
    const total = componentTotal(components);

    if (Math.abs(total - examSubject.maxScore) >= 0.005) {
      throw new ConflictException(
        `The active components add up to ${total} but this subject is out of ${examSubject.maxScore}. Make the two agree before entering scores.`,
      );
    }

    // No student twice in the list
    const studentIds = dto.entries.map((entry) => entry.studentId);

    if (new Set(studentIds).size !== studentIds.length) {
      throw new BadRequestException('A student appears more than once in the list');
    }

    const enrolled = new Set(
      (
        await this.prisma.enrollment.findMany({
          where: {
            classId: examination.classId,
            status: EnrollmentStatus.ACTIVE,
            studentId: { in: studentIds },
          },
          select: { studentId: true },
        })
      ).map((e) => e.studentId),
    );

    const existingResults = await this.prisma.result.findMany({
      where: {
        examinationId: examination.id,
        subjectId: dto.subjectId,
        studentId: { in: studentIds },
      },
      include: { componentScores: true },
    });

    const existingByStudent = new Map(existingResults.map((r) => [r.studentId, r]));

    // ---- Check every row first. If any row is wrong, save nothing. ----
    const problems: { studentId: string; errors: string[] }[] = [];
    const prepared: {
      studentId: string;
      remark?: string;
      incoming: { componentId: string; score: number }[];
      caScore: number | null;
      examScore: number | null;
      totalScore: number;
      complete: boolean;
    }[] = [];

    for (const entry of dto.entries) {
      const errors: string[] = [];

      if (!enrolled.has(entry.studentId)) {
        errors.push('Student is not actively enrolled in this class');
      }

      errors.push(...validateEntryScores(components, entry.scores));

      const existing = existingByStudent.get(entry.studentId);
      const existingMap: ScoreMap = {};

      for (const item of existing?.componentScores ?? []) {
        existingMap[item.componentId] = item.score;
      }

      const merged = mergeScores(existingMap, entry.scores);
      const summary = summarizeScores(components, merged);

      // A result entered the old way has no component marks to build on
      const legacy =
        !!existing &&
        existing.componentScores.length === 0 &&
        (existing.caScore != null || existing.examScore != null);

      if (legacy && !summary.complete) {
        errors.push(
          `This result was entered the old way. Enter every component: ${summary.missing.join(', ')}`,
        );
      }

      if (summary.totalScore > examSubject.maxScore + 0.005) {
        errors.push(`Total ${summary.totalScore} is above ${examSubject.maxScore}`);
      }

      if (errors.length > 0) {
        problems.push({ studentId: entry.studentId, errors });
        continue;
      }

      prepared.push({
        studentId: entry.studentId,
        remark: entry.remark,
        incoming: entry.scores,
        caScore: summary.caScore,
        examScore: summary.examScore,
        totalScore: summary.totalScore,
        complete: summary.complete,
      });
    }

    if (problems.length > 0) {
      throw new BadRequestException({
        message: 'Some entries are invalid. Nothing was saved.',
        errors: problems,
      });
    }

    const { bands } = await this.gradingService.getEffectiveBands(schoolId);

    // ---- Save everything, or nothing ----
    await this.prisma.$transaction(
      async (tx) => {
        for (const row of prepared) {
          // The grade is only given once every component has a mark
          const grade = row.complete
            ? gradeFor(bands, percentageOf(row.totalScore, examSubject.maxScore)).grade
            : null;

          const result = await tx.result.upsert({
            where: {
              studentId_examinationId_subjectId: {
                studentId: row.studentId,
                examinationId: examination.id,
                subjectId: dto.subjectId,
              },
            },
            create: {
              studentId: row.studentId,
              examinationId: examination.id,
              subjectId: dto.subjectId,
              termId: examination.termId,
              teacherId: teacherId ?? null,
              caScore: row.caScore,
              examScore: row.examScore,
              totalScore: row.totalScore,
              grade,
              remark: row.remark ?? null,
            },
            update: {
              ...(teacherId ? { teacherId } : {}),
              caScore: row.caScore,
              examScore: row.examScore,
              totalScore: row.totalScore,
              grade,
              ...(row.remark !== undefined ? { remark: row.remark } : {}),
            },
          });

          const componentIds = row.incoming.map((s) => s.componentId);

          await tx.resultComponentScore.deleteMany({
            where: { resultId: result.id, componentId: { in: componentIds } },
          });

          await tx.resultComponentScore.createMany({
            data: row.incoming.map((s) => ({
              resultId: result.id,
              componentId: s.componentId,
              score: roundTo2(s.score),
            })),
          });
        }
      },
      { timeout: 30000 },
    );

    const complete = prepared.filter((row) => row.complete).length;

    return {
      examinationId: examination.id,
      subjectId: dto.subjectId,
      saved: prepared.length,
      complete,
      incomplete: prepared.length - complete,
    };
  }
}
