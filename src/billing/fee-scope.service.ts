import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

import { SetFeeScopeDto } from './dto/billing.dto';

// Says WHO a fee is for: one class, a whole level, or everyone (no scope)
@Injectable()
export class FeeScopeService {
  constructor(private readonly prisma: PrismaService) {}

  private requireSchoolId(user: RequestUser): string {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    return user.schoolId;
  }

  async findAll(user: RequestUser, termId?: string) {
    const schoolId = this.requireSchoolId(user);

    return this.prisma.feeStructure.findMany({
      where: { schoolId, ...(termId ? { termId } : {}) },
      select: {
        id: true,
        name: true,
        amount: true,
        termId: true,
        level: { select: { id: true, name: true } },
        class: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async setScope(feeStructureId: string, dto: SetFeeScopeDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    if (dto.classId && dto.levelId) {
      throw new BadRequestException('Choose either a class or a level, not both');
    }

    const fee = await this.prisma.feeStructure.findFirst({
      where: { id: feeStructureId, schoolId },
      select: { id: true },
    });

    if (!fee) {
      throw new NotFoundException('Fee structure not found');
    }

    if (dto.classId) {
      const schoolClass = await this.prisma.schoolClass.findFirst({
        where: { id: dto.classId, schoolId },
        select: { id: true },
      });

      if (!schoolClass) {
        throw new NotFoundException('Class not found in this school');
      }
    }

    if (dto.levelId) {
      const level = await this.prisma.classLevel.findFirst({
        where: { id: dto.levelId, schoolId },
        select: { id: true },
      });

      if (!level) {
        throw new NotFoundException('Class level not found in this school');
      }
    }

    return this.prisma.feeStructure.update({
      where: { id: feeStructureId },
      data: { classId: dto.classId ?? null, levelId: dto.levelId ?? null },
      select: {
        id: true,
        name: true,
        amount: true,
        level: { select: { id: true, name: true } },
        class: { select: { id: true, name: true } },
      },
    });
  }
}
