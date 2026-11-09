import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';
import { roundTo2 } from '../grading/grading.logic';

import {
  CreateAssessmentComponentDto,
  UpdateAssessmentComponentDto,
} from './dto/assessment-component.dto';

const IN_ORDER = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }];

@Injectable()
export class AssessmentComponentsService {
  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------

  private requireSchoolId(user: RequestUser): string {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    return user.schoolId;
  }

  private cleanName(name: string): string {
    const trimmed = name.trim();

    if (trimmed.length === 0) {
      throw new BadRequestException('Name is required');
    }

    return trimmed;
  }

  private async getOwned(id: string, schoolId: string) {
    const component = await this.prisma.assessmentComponent.findFirst({
      where: { id, schoolId },
    });

    if (!component) {
      throw new NotFoundException('Assessment component not found');
    }

    return component;
  }

  private async assertNameFree(schoolId: string, name: string, exceptId?: string) {
    const sameName = await this.prisma.assessmentComponent.findFirst({
      where: { schoolId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });

    if (sameName) {
      throw new ConflictException('A component with this name already exists');
    }
  }

  // The old caScore/examScore fields need exactly one exam slice.
  private async assertNoOtherActiveExam(schoolId: string, exceptId?: string) {
    const other = await this.prisma.assessmentComponent.findFirst({
      where: {
        schoolId,
        isExam: true,
        isActive: true,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });

    if (other) {
      throw new ConflictException(
        'This school already has an active exam component. Only one is allowed.',
      );
    }
  }

  private async countScores(componentId: string) {
    return this.prisma.resultComponentScore.count({ where: { componentId } });
  }

  // --------------------------------------------------
  // Read
  // --------------------------------------------------

  async findAll(user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const components = await this.getAll(schoolId);

    return {
      components,
      // What a student's score adds up to when every ACTIVE slice is full
      totalMax: roundTo2(
        components
          .filter((component) => component.isActive)
          .reduce((sum, component) => sum + component.maxScore, 0),
      ),
    };
  }

  private getAll(schoolId: string) {
    return this.prisma.assessmentComponent.findMany({
      where: { schoolId },
      orderBy: IN_ORDER,
    });
  }

  // Used later by bulk score entry
  async getActiveComponents(schoolId: string) {
    return this.prisma.assessmentComponent.findMany({
      where: { schoolId, isActive: true },
      orderBy: IN_ORDER,
    });
  }

  // --------------------------------------------------
  // Create / update / delete
  // --------------------------------------------------

  async create(dto: CreateAssessmentComponentDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const name = this.cleanName(dto.name);

    await this.assertNameFree(schoolId, name);

    if (dto.isExam === true) {
      await this.assertNoOtherActiveExam(schoolId);
    }

    // Put it at the end of the list unless a position was given
    const last = await this.prisma.assessmentComponent.findFirst({
      where: { schoolId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return this.prisma.assessmentComponent.create({
      data: {
        schoolId,
        name,
        maxScore: dto.maxScore,
        isExam: dto.isExam ?? false,
        sortOrder: dto.sortOrder ?? (last ? last.sortOrder + 1 : 1),
      },
    });
  }

  async update(id: string, dto: UpdateAssessmentComponentDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const current = await this.getOwned(id, schoolId);

    const name = dto.name === undefined ? undefined : this.cleanName(dto.name);

    if (name !== undefined) {
      await this.assertNameFree(schoolId, name, id);
    }

    // Changing the max score or the exam flag would change what saved scores mean
    const changesMeaning =
      (dto.maxScore !== undefined && dto.maxScore !== current.maxScore) ||
      (dto.isExam !== undefined && dto.isExam !== current.isExam);

    if (changesMeaning && (await this.countScores(id)) > 0) {
      throw new ConflictException(
        'Scores are already saved for this component, so its max score and exam setting cannot change. Deactivate it and add a new component instead.',
      );
    }

    const nextIsExam = dto.isExam ?? current.isExam;
    const nextIsActive = dto.isActive ?? current.isActive;

    if (nextIsExam && nextIsActive) {
      await this.assertNoOtherActiveExam(schoolId, id);
    }

    return this.prisma.assessmentComponent.update({
      where: { id },
      data: {
        name,
        maxScore: dto.maxScore,
        isExam: dto.isExam,
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      },
    });
  }

  async remove(id: string, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    await this.getOwned(id, schoolId);

    if ((await this.countScores(id)) > 0) {
      throw new ConflictException(
        'This component already has scores. Deactivate it instead of deleting it.',
      );
    }

    await this.prisma.assessmentComponent.delete({ where: { id } });

    return { deleted: true };
  }

  // One click setup: "CA" out of 40 and "Exam" out of 60,
  // which is the same split the app has always used.
  async createDefaults(user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    const existing = await this.prisma.assessmentComponent.count({
      where: { schoolId },
    });

    if (existing > 0) {
      throw new ConflictException('This school already has components');
    }

    await this.prisma.assessmentComponent.createMany({
      data: [
        { schoolId, name: 'CA', maxScore: 40, isExam: false, sortOrder: 1 },
        { schoolId, name: 'Exam', maxScore: 60, isExam: true, sortOrder: 2 },
      ],
    });

    return this.findAll(user);
  }
}