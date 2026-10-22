import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  ExaminationStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreateExaminationDto } from './dto/create-examination.dto';
import { UpdateExaminationDto } from './dto/update-examination.dto';
import { ExamSubject } from './dto/exam-subject.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Injectable()
export class ExaminationsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private async getSchoolId(
    user: RequestUser,
  ): Promise<string> {
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

    return membership.schoolId;
  }

  private ensureCanManage(
    user: RequestUser,
  ) {
    const allowedRoles: UserRole[] = [
      UserRole.SUPER_ADMIN,
      UserRole.SCHOOL_ADMIN,
    ];

    if (!allowedRoles.includes(user.role)) {
      throw new ForbiddenException(
        'You do not have permission to manage examinations',
      );
    }
  }

  private validateDates(
    startDate?: Date,
    endDate?: Date,
  ) {
    if (
      startDate &&
      endDate &&
      startDate > endDate
    ) {
      throw new ConflictException(
        'Start date cannot be after end date',
      );
    }
  }

  async create(
    dto: CreateExaminationDto,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const schoolId =
      await this.getSchoolId(user);

    const session =
      await this.prisma.academicSession.findFirst({
        where: {
          id: dto.sessionId,
          schoolId,
        },
      });

    if (!session) {
      throw new NotFoundException(
        'Academic session not found',
      );
    }

    const term =
      await this.prisma.term.findFirst({
        where: {
          id: dto.termId,
          academicSessionId: session.id,
        },
      });

    if (!term) {
      throw new NotFoundException(
        'Term not found in the selected academic session',
      );
    }

    const schoolClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          id: dto.classId,
          schoolId,
          academicSessionId: session.id,
        },
      });

    if (!schoolClass) {
      throw new NotFoundException(
        'Class not found in the selected academic session',
      );
    }

    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : undefined;

    const endDate = dto.endDate
      ? new Date(dto.endDate)
      : undefined;

    this.validateDates(
      startDate,
      endDate,
    );

    if (
      startDate &&
      (
        startDate < session.startDate ||
        startDate > session.endDate
      )
    ) {
      throw new ConflictException(
        'Examination start date is outside the academic session',
      );
    }

    if (
      endDate &&
      (
        endDate < session.startDate ||
        endDate > session.endDate
      )
    ) {
      throw new ConflictException(
        'Examination end date is outside the academic session',
      );
    }

    const existing =
      await this.prisma.examination.findFirst({
        where: {
          schoolId,
          classId: schoolClass.id,
          termId: term.id,
          name: dto.name,
        },
      });

    if (existing) {
      throw new ConflictException(
        'An examination with this name already exists for this class and term',
      );
    }

    return this.prisma.examination.create({
      data: {
        schoolId,
        sessionId: session.id,
        termId: term.id,
        classId: schoolClass.id,
        name: dto.name,
        status:
          dto.status ??
          ExaminationStatus.DRAFT,
        startDate,
        endDate,
      },
      include: {
        session: true,
        term: true,
        class: true,
        subjects: {
          include: {
            subject: true,
          },
        },
      },
    });
  }

  async findAll(
    user: RequestUser, query: PaginationQueryDto = new PaginationQueryDto(),
  ) {
    const schoolId =
      await this.getSchoolId(user);

    const where: any = { schoolId, ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}) };
    const page = query.getPage(); const limit = query.getLimit();
    const result = await this.prisma.examination.findMany({ where,
      include: {
        session: true,
        term: true,
        class: true,
        subjects: {
          include: {
            subject: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      ...(query.paginated ? { skip: (page - 1) * limit, take: limit } : {}),
    });
    if (!query.paginated) return result;
    const total = await this.prisma.examination.count({ where });
    return { data: result, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(
    id: string,
    user: RequestUser,
  ) {
    const schoolId =
      await this.getSchoolId(user);

    const examination =
      await this.prisma.examination.findFirst({
        where: {
          id,
          schoolId,
        },
        include: {
          session: true,
          term: true,
          class: true,
          subjects: {
            include: {
              subject: true,
            },
          },
          results: true,
        },
      });

    if (!examination) {
      throw new NotFoundException(
        'Examination not found',
      );
    }

    return examination;
  }

  async update(
    id: string,
    dto: UpdateExaminationDto,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const schoolId =
      await this.getSchoolId(user);

    const examination =
      await this.prisma.examination.findFirst({
        where: {
          id,
          schoolId,
        },
        include: {
          session: true,
        },
      });

    if (!examination) {
      throw new NotFoundException(
        'Examination not found',
      );
    }

    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : undefined;

    const endDate = dto.endDate
      ? new Date(dto.endDate)
      : undefined;

    this.validateDates(
      startDate,
      endDate,
    );

    if (
      startDate &&
      (
        startDate < examination.session.startDate ||
        startDate > examination.session.endDate
      )
    ) {
      throw new ConflictException(
        'Examination start date is outside the academic session',
      );
    }

    if (
      endDate &&
      (
        endDate < examination.session.startDate ||
        endDate > examination.session.endDate
      )
    ) {
      throw new ConflictException(
        'Examination end date is outside the academic session',
      );
    }

    if (dto.name) {
      const duplicate =
        await this.prisma.examination.findFirst({
          where: {
            id: {
              not: id,
            },
            schoolId,
            classId: examination.classId,
            termId: examination.termId,
            name: dto.name,
          },
        });

      if (duplicate) {
        throw new ConflictException(
          'An examination with this name already exists for this class and term',
        );
      }
    }

    return this.prisma.examination.update({
      where: {
        id,
      },
      data: {
        ...(dto.name !== undefined
          ? {
              name: dto.name,
            }
          : {}),

        ...(dto.status !== undefined
          ? {
              status: dto.status,
            }
          : {}),

        ...(startDate !== undefined
          ? {
              startDate,
            }
          : {}),

        ...(endDate !== undefined
          ? {
              endDate,
            }
          : {}),
      },
      include: {
        session: true,
        term: true,
        class: true,
        subjects: {
          include: {
            subject: true,
          },
        },
      },
    });
  }


  async addSubject(id: string, dto: ExamSubject, user: RequestUser) {
    this.ensureCanManage(user);
    const schoolId = await this.getSchoolId(user);
    const examination = await this.prisma.examination.findFirst({ where: { id, schoolId } });
    if (!examination) throw new NotFoundException('Examination not found');
    if (examination.status === ExaminationStatus.PUBLISHED) throw new ConflictException('Published examinations cannot be changed');
    const subject = await this.prisma.subject.findFirst({ where: { id: dto.subjectId, schoolId, classAssignments: { some: { classId: examination.classId } } } });
    if (!subject) throw new NotFoundException('Subject is not assigned to this examination class');
    return this.prisma.examinationSubject.upsert({
      where: { examinationId_subjectId: { examinationId: id, subjectId: dto.subjectId } },
      create: { examinationId: id, subjectId: dto.subjectId, maxScore: dto.maxScore },
      update: { maxScore: dto.maxScore },
      include: { subject: true },
    });
  }

  async removeSubject(id: string, subjectId: string, user: RequestUser) {
    this.ensureCanManage(user);
    const schoolId = await this.getSchoolId(user);
    const examination = await this.prisma.examination.findFirst({ where: { id, schoolId } });
    if (!examination) throw new NotFoundException('Examination not found');
    if (examination.status === ExaminationStatus.PUBLISHED) throw new ConflictException('Published examinations cannot be changed');
    const item = await this.prisma.examinationSubject.findUnique({ where: { examinationId_subjectId: { examinationId: id, subjectId } } });
    if (!item) throw new NotFoundException('Examination subject not found');
    const resultCount = await this.prisma.result.count({ where: { examinationId: id, subjectId } });
    if (resultCount) throw new ConflictException('Cannot remove a subject that already has results');
    await this.prisma.examinationSubject.delete({ where: { id: item.id } });
    return { message: 'Examination subject removed successfully' };
  }

  async remove(
    id: string,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const schoolId =
      await this.getSchoolId(user);

    const examination =
      await this.prisma.examination.findFirst({
        where: {
          id,
          schoolId,
        },
      });

    if (!examination) {
      throw new NotFoundException(
        'Examination not found',
      );
    }

    if (
      examination.status ===
      ExaminationStatus.PUBLISHED
    ) {
      throw new ConflictException(
        'Published examinations cannot be deleted',
      );
    }

    await this.prisma.examination.delete({
      where: {
        id,
      },
    });

    return {
      message:
        'Examination deleted successfully',
    };
  }
}