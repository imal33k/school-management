import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DiscountType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreateDiscountDto, UpdateDiscountDto } from './dto/billing.dto';

@Injectable()
export class DiscountsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireSchoolId(user: RequestUser): string {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    return user.schoolId;
  }

  private assertValue(type: DiscountType, value: number) {
    if (type === DiscountType.PERCENTAGE && value > 100) {
      throw new BadRequestException('A percentage discount cannot be more than 100');
    }
  }

  async create(dto: CreateDiscountDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const name = dto.name.trim();

    if (!name) {
      throw new BadRequestException('Name is required');
    }

    this.assertValue(dto.type, dto.value);

    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, schoolId },
      select: { id: true },
    });

    if (!student) {
      throw new NotFoundException('Student not found in this school');
    }

    if (dto.feeStructureId) {
      const fee = await this.prisma.feeStructure.findFirst({
        where: { id: dto.feeStructureId, schoolId },
        select: { id: true },
      });

      if (!fee) {
        throw new NotFoundException('Fee structure not found in this school');
      }
    }

    if (dto.termId) {
      const term = await this.prisma.term.findFirst({
        where: { id: dto.termId, academicSession: { schoolId } },
        select: { id: true },
      });

      if (!term) {
        throw new NotFoundException('Term not found in this school');
      }
    }

    return this.prisma.studentDiscount.create({
      data: {
        schoolId,
        studentId: dto.studentId,
        name,
        type: dto.type,
        value: dto.value,
        feeStructureId: dto.feeStructureId ?? null,
        termId: dto.termId ?? null,
        reason: dto.reason?.trim() || null,
      },
    });
  }

  async findAll(user: RequestUser, studentId?: string) {
    const schoolId = this.requireSchoolId(user);

    return this.prisma.studentDiscount.findMany({
      where: { schoolId, ...(studentId ? { studentId } : {}) },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
        feeStructure: { select: { id: true, name: true } },
        term: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, dto: UpdateDiscountDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    const current = await this.prisma.studentDiscount.findFirst({ where: { id, schoolId } });

    if (!current) {
      throw new NotFoundException('Discount not found');
    }

    if (dto.value !== undefined) {
      this.assertValue(current.type, dto.value);
    }

    const name = dto.name === undefined ? undefined : dto.name.trim();

    if (name !== undefined && !name) {
      throw new BadRequestException('Name is required');
    }

    return this.prisma.studentDiscount.update({
      where: { id },
      data: {
        name,
        value: dto.value,
        isActive: dto.isActive,
        reason: dto.reason === undefined ? undefined : dto.reason.trim() || null,
      },
    });
  }

  async remove(id: string, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    if (!(await this.prisma.studentDiscount.findFirst({ where: { id, schoolId }, select: { id: true } }))) {
      throw new NotFoundException('Discount not found');
    }

    await this.prisma.studentDiscount.delete({ where: { id } });

    return { deleted: true };
  }
}
