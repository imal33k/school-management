import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  ExaminationStatus,
  Prisma,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreateResultDto } from './dto/create-result.dto';
import { UpdateResultDto } from './dto/update-result.dto';

@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------
  // CREATE RESULT
  // --------------------------------------------------

  async create(
    user: RequestUser,
    dto: CreateResultDto,
  ) {
    // Only teachers and school admins can enter results
    if (
      user.role !== UserRole.TEACHER &&
      user.role !== UserRole.SCHOOL_ADMIN
    ) {
      throw new ForbiddenException(
        'You are not allowed to enter results',
      );
    }

    // Find user's school
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
        },
      });

    if (!membership) {
      throw new ForbiddenException(
        'You are not a member of any school',
      );
    }

    const schoolId = membership.schoolId;

    // --------------------------------------------------
    // Find examination
    // --------------------------------------------------

    const examination =
      await this.prisma.examination.findFirst({
        where: {
          id: dto.examinationId,
          schoolId,
        },
        include: {
          class: true,
          term: true,
          subjects: true,
        },
      });

    if (!examination) {
      throw new NotFoundException(
        'Examination not found in this school',
      );
    }

    // Results can only be entered when exam is OPEN
    if (
      examination.status !==
      ExaminationStatus.OPEN
    ) {
      throw new ConflictException(
        'Results can only be entered for an open examination',
      );
    }

    // --------------------------------------------------
    // Find student
    // --------------------------------------------------

    const student =
      await this.prisma.student.findFirst({
        where: {
          id: dto.studentId,
          schoolId,
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found in this school',
      );
    }

    // --------------------------------------------------
    // Check student is enrolled in exam class
    // --------------------------------------------------

    const enrollment =
      await this.prisma.enrollment.findFirst({
        where: {
          studentId: dto.studentId,
          classId: examination.classId,
          status: 'ACTIVE',
        },
      });

    if (!enrollment) {
      throw new ForbiddenException(
        'Student is not enrolled in the examination class',
      );
    }

    // --------------------------------------------------
    // Find examination subject
    // --------------------------------------------------

    const examinationSubject =
      await this.prisma.examinationSubject.findUnique({
        where: {
          examinationId_subjectId: {
            examinationId: dto.examinationId,
            subjectId: dto.subjectId,
          },
        },
        include: {
          subject: true,
        },
      });

    if (!examinationSubject) {
      throw new NotFoundException(
        'This subject is not part of the examination',
      );
    }

    // --------------------------------------------------
    // Teacher authorization
    // --------------------------------------------------

    let teacherId: string | undefined;

    if (user.role === UserRole.TEACHER) {
      const teacher =
        await this.prisma.teacher.findUnique({
          where: {
            userId: user.id,
          },
        });

      if (!teacher) {
        throw new NotFoundException(
          'Teacher profile not found',
        );
      }

      // Teacher must be assigned to the examination class
      const classAssignment =
        await this.prisma.classTeacher.findUnique({
          where: {
            classId_teacherId: {
              classId: examination.classId,
              teacherId: teacher.id,
            },
          },
        });

      if (!classAssignment) {
        throw new ForbiddenException(
          'You are not assigned to this class',
        );
      }

      // Teacher must also be assigned to this subject
      const subjectAssignment =
        await this.prisma.teacherSubject.findUnique({
          where: {
            teacherId_subjectId: {
              teacherId: teacher.id,
              subjectId: dto.subjectId,
            },
          },
        });

      if (!subjectAssignment) {
        throw new ForbiddenException(
          'You are not assigned to this subject',
        );
      }

      teacherId = teacher.id;
    }

    // --------------------------------------------------
    // Validate scores
    // --------------------------------------------------

    const caScore = dto.caScore ?? 0;
    const examScore = dto.examScore ?? 0;

    const totalScore = caScore + examScore;

    if (
      totalScore >
      examinationSubject.maxScore
    ) {
      throw new ConflictException(
        `Total score cannot exceed ${examinationSubject.maxScore}`,
      );
    }

    // --------------------------------------------------
    // Check duplicate result
    // --------------------------------------------------

    const existingResult =
      await this.prisma.result.findUnique({
        where: {
          studentId_examinationId_subjectId: {
            studentId: dto.studentId,
            examinationId: dto.examinationId,
            subjectId: dto.subjectId,
          },
        },
      });

    if (existingResult) {
      throw new ConflictException(
        'A result already exists for this student, examination and subject',
      );
    }

    // --------------------------------------------------
    // Calculate grade
    // --------------------------------------------------

    const grade = this.calculateGrade(
      totalScore,
      examinationSubject.maxScore,
    );

    // --------------------------------------------------
    // Create result
    // --------------------------------------------------

    return this.prisma.result.create({
      data: {
        studentId: dto.studentId,
        examinationId: dto.examinationId,
        subjectId: dto.subjectId,
        teacherId,
        termId: examination.termId,
        caScore,
        examScore,
        totalScore,
        grade,
        remark: dto.remark,
      },
      include: {
        student: true,
        examination: true,
        subject: true,
        teacher: true,
        term: true,
      },
    });
  }

  // --------------------------------------------------
  // FIND ALL
  // --------------------------------------------------


  async findMine(user: RequestUser) {
    const student = await this.prisma.student.findFirst({ where: { userId: user.id } });
    if (!student) throw new NotFoundException('Student profile not found');
    return this.prisma.result.findMany({ where: { studentId: student.id }, include: { examination: true, subject: true, term: true, teacher: true }, orderBy: { createdAt: 'desc' } });
  }

  async findAll(user: RequestUser) {
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
        },
      });

    if (!membership) {
      throw new ForbiddenException(
        'You are not a member of any school',
      );
    }

    return this.prisma.result.findMany({
      where: {
        examination: {
          schoolId: membership.schoolId,
        },
      },
      include: {
        student: true,
        examination: true,
        subject: true,
        teacher: true,
        term: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // --------------------------------------------------
  // FIND ONE
  // --------------------------------------------------

  async findOne(
    user: RequestUser,
    id: string,
  ) {
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
        },
      });

    if (!membership) {
      throw new ForbiddenException(
        'You are not a member of any school',
      );
    }

    const result =
      await this.prisma.result.findFirst({
        where: {
          id,
          examination: {
            schoolId: membership.schoolId,
          },
        },
        include: {
          student: true,
          examination: {
            include: {
              class: true,
            },
          },
          subject: true,
          teacher: true,
          term: true,
        },
      });

    if (!result) {
      throw new NotFoundException(
        'Result not found',
      );
    }

    return result;
  }

  // --------------------------------------------------
  // UPDATE RESULT
  // --------------------------------------------------

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateResultDto,
  ) {
    if (
      user.role !== UserRole.TEACHER &&
      user.role !== UserRole.SCHOOL_ADMIN
    ) {
      throw new ForbiddenException(
        'You are not allowed to update results',
      );
    }

    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
        },
      });

    if (!membership) {
      throw new ForbiddenException(
        'You are not a member of any school',
      );
    }

    const result =
      await this.prisma.result.findFirst({
        where: {
          id,
          examination: {
            schoolId: membership.schoolId,
          },
        },
        include: {
          examination: true,
        },
      });

    if (!result) {
      throw new NotFoundException(
        'Result not found',
      );
    }

    // Results cannot be changed after publication
    if (
      result.examination.status ===
      ExaminationStatus.PUBLISHED
    ) {
      throw new ConflictException(
        'Published results cannot be modified',
      );
    }

    // Teacher authorization
    if (user.role === UserRole.TEACHER) {
      const teacher =
        await this.prisma.teacher.findUnique({
          where: {
            userId: user.id,
          },
        });

      if (!teacher) {
        throw new NotFoundException(
          'Teacher profile not found',
        );
      }

      if (result.teacherId !== teacher.id) {
        throw new ForbiddenException(
          'You can only update results you entered',
        );
      }
    }

    const caScore =
      dto.caScore ?? result.caScore ?? 0;

    const examScore =
      dto.examScore ?? result.examScore ?? 0;

    // Find max score
    const examinationSubject =
      await this.prisma.examinationSubject.findUnique({
        where: {
          examinationId_subjectId: {
            examinationId: result.examinationId,
            subjectId: result.subjectId,
          },
        },
      });

    if (!examinationSubject) {
      throw new NotFoundException(
        'Examination subject not found',
      );
    }

    const totalScore =
      caScore + examScore;

    if (
      totalScore >
      examinationSubject.maxScore
    ) {
      throw new ConflictException(
        `Total score cannot exceed ${examinationSubject.maxScore}`,
      );
    }

    const grade = this.calculateGrade(
      totalScore,
      examinationSubject.maxScore,
    );

    return this.prisma.result.update({
      where: {
        id,
      },
      data: {
        caScore,
        examScore,
        totalScore,
        grade,
        ...(dto.remark !== undefined && {
          remark: dto.remark,
        }),
      },
      include: {
        student: true,
        examination: true,
        subject: true,
        teacher: true,
        term: true,
      },
    });
  }

  // --------------------------------------------------
  // DELETE RESULT
  // --------------------------------------------------

  async remove(
    user: RequestUser,
    id: string,
  ) {
    if (user.role !== UserRole.SCHOOL_ADMIN) {
      throw new ForbiddenException(
        'Only school admins can delete results',
      );
    }

    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          role: UserRole.SCHOOL_ADMIN,
        },
      });

    if (!membership) {
      throw new ForbiddenException(
        'You are not a school admin',
      );
    }

    const result =
      await this.prisma.result.findFirst({
        where: {
          id,
          examination: {
            schoolId: membership.schoolId,
          },
        },
        include: {
          examination: true,
        },
      });

    if (!result) {
      throw new NotFoundException(
        'Result not found',
      );
    }

    if (
      result.examination.status ===
      ExaminationStatus.PUBLISHED
    ) {
      throw new ConflictException(
        'Published results cannot be deleted',
      );
    }

    return this.prisma.result.delete({
      where: {
        id,
      },
    });
  }

  // --------------------------------------------------
  // GRADE CALCULATION
  // --------------------------------------------------

  private calculateGrade(
    totalScore: number,
    maxScore: number,
  ): string {
    const percentage =
      (totalScore / maxScore) * 100;

    if (percentage >= 70) {
      return 'A';
    }

    if (percentage >= 60) {
      return 'B';
    }

    if (percentage >= 50) {
      return 'C';
    }

    if (percentage >= 45) {
      return 'D';
    }

    if (percentage >= 40) {
      return 'E';
    }

    return 'F';
  }
}