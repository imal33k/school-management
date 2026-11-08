import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

import {
  CreateGradeScaleDto,
  GradeBandDto,
  UpdateGradeScaleDto,
} from './dto/grade-scale.dto';
import { LEGACY_BANDS, validateBands, type GradeBandInput } from './grading.logic';

@Injectable()
export class GradingService {
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

  private checkBands(bands: GradeBandDto[]) {
    const errors = validateBands(bands);

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Invalid grading scale',
        errors,
      });
    }
  }

  private toBandRows(bands: GradeBandDto[]) {
    return bands.map((band) => ({
      grade: band.grade.trim(),
      minScore: band.minScore,
      remark: band.remark?.trim() || null,
      points: band.points ?? null,
    }));
  }

  private readonly withBands = {
    bands: { orderBy: { minScore: 'desc' as const } },
  };

  private async getOwnedScale(id: string, schoolId: string) {
    const scale = await this.prisma.gradeScale.findFirst({
      where: { id, schoolId },
      include: this.withBands,
    });

    if (!scale) {
      throw new NotFoundException('Grading scale not found');
    }

    return scale;
  }

  // --------------------------------------------------
  // Create / read / update / delete
  // --------------------------------------------------

  async create(dto: CreateGradeScaleDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const name = this.cleanName(dto.name);

    this.checkBands(dto.bands);

    const sameName = await this.prisma.gradeScale.findFirst({
      where: { schoolId, name },
      select: { id: true },
    });

    if (sameName) {
      throw new ConflictException('A grading scale with this name already exists');
    }

    const existingCount = await this.prisma.gradeScale.count({
      where: { schoolId },
    });

    // The first scale a school creates becomes its default automatically
    const makeDefault = dto.isDefault === true || existingCount === 0;

    return this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.gradeScale.updateMany({
          where: { schoolId },
          data: { isDefault: false },
        });
      }

      return tx.gradeScale.create({
        data: {
          schoolId,
          name,
          isDefault: makeDefault,
          bands: { create: this.toBandRows(dto.bands) },
        },
        include: this.withBands,
      });
    });
  }

  async findAll(user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    return this.prisma.gradeScale.findMany({
      where: { schoolId },
      include: this.withBands,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    return this.getOwnedScale(id, schoolId);
  }

  async update(id: string, dto: UpdateGradeScaleDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    await this.getOwnedScale(id, schoolId);

    const name = dto.name === undefined ? undefined : this.cleanName(dto.name);

    if (dto.bands) {
      this.checkBands(dto.bands);
    }

    if (name !== undefined) {
      const sameName = await this.prisma.gradeScale.findFirst({
        where: { schoolId, name, NOT: { id } },
        select: { id: true },
      });

      if (sameName) {
        throw new ConflictException(
          'A grading scale with this name already exists',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (name !== undefined) {
        await tx.gradeScale.update({ where: { id }, data: { name } });
      }

      if (dto.bands) {
        await tx.gradeBand.deleteMany({ where: { gradeScaleId: id } });
        await tx.gradeBand.createMany({
          data: this.toBandRows(dto.bands).map((row) => ({
            ...row,
            gradeScaleId: id,
          })),
        });
      }

      return tx.gradeScale.findUniqueOrThrow({
        where: { id },
        include: this.withBands,
      });
    });
  }

  async setDefault(id: string, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    await this.getOwnedScale(id, schoolId);

    return this.prisma.$transaction(async (tx) => {
      await tx.gradeScale.updateMany({
        where: { schoolId },
        data: { isDefault: false },
      });

      return tx.gradeScale.update({
        where: { id },
        data: { isDefault: true },
        include: this.withBands,
      });
    });
  }

  async remove(id: string, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const scale = await this.getOwnedScale(id, schoolId);

    if (scale.isDefault) {
      const others = await this.prisma.gradeScale.count({
        where: { schoolId, NOT: { id } },
      });

      if (others > 0) {
        throw new ConflictException(
          'This is the default scale. Make another scale the default first.',
        );
      }
    }

    await this.prisma.gradeScale.delete({ where: { id } });

    return { deleted: true };
  }

  // --------------------------------------------------
  // The scale a school is actually using right now
  // --------------------------------------------------

  // Used by results and report cards. Falls back to the built-in scale
  // when the school has not set up its own, so nothing changes for them.
  async getEffectiveBands(schoolId: string): Promise<{
    source: 'custom' | 'built-in';
    scaleId: string | null;
    name: string;
    bands: GradeBandInput[];
  }> {
    const scale = await this.prisma.gradeScale.findFirst({
      where: { schoolId, isDefault: true },
      include: this.withBands,
      orderBy: { updatedAt: 'desc' },
    });

    if (!scale || scale.bands.length === 0) {
      return {
        source: 'built-in',
        scaleId: null,
        name: 'Built-in scale',
        bands: LEGACY_BANDS,
      };
    }

    return {
      source: 'custom',
      scaleId: scale.id,
      name: scale.name,
      bands: scale.bands.map((band) => ({
        grade: band.grade,
        minScore: band.minScore,
        remark: band.remark,
        points: band.points,
      })),
    };
  }

  async getEffective(user: RequestUser) {
    return this.getEffectiveBands(this.requireSchoolId(user));
  }
}