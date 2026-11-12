import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { SchoolStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

import { UpdateSchoolDto } from './dto/update-school.dto';
import { CreatePaystackSubaccountDto } from './dto/create-paystack-subaccount.dto';
import { PaystackService } from '../payments/paystack.service';

@Injectable()
export class SchoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
  ) {}

  private formatSchool<T extends { paystackSubaccountCode: string | null }>(
    school: T,
  ) {
    const { paystackSubaccountCode, ...safeSchool } = school;
    return {
      ...safeSchool,
      hasPaystackSubaccount: Boolean(paystackSubaccountCode),
    };
  }

  private async getSchoolId(user: RequestUser): Promise<string> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        userId: user.id,
        ...(user.schoolId ? { schoolId: user.schoolId } : {}),
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of any school');
    }

    return membership.schoolId;
  }

  private ensureCanManage(user: RequestUser) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'You do not have permission to manage school information',
      );
    }
  }

  async findMine(user: RequestUser) {
    const schoolId = await this.getSchoolId(user);

    const school = await this.prisma.school.findUnique({
      where: {
        id: schoolId,
      },
      include: {
        _count: {
          select: {
            students: true,
            teachers: true,
            parents: true,
            classes: true,
            subjects: true,
          },
        },
      },
    });

    if (!school) {
      throw new NotFoundException('School not found');
    }

    return this.formatSchool(school);
  }

  async createPaystackSubaccount(
    dto: CreatePaystackSubaccountDto,
    user: RequestUser,
  ) {
    if (user.role !== UserRole.SCHOOL_ADMIN) {
      throw new ForbiddenException(
        'Only school administrators can configure school settlement',
      );
    }
    const schoolId = await this.getSchoolId(user);
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        paystackSubaccountCode: true,
        paystackSubaccountSetupStartedAt: true,
      },
    });
    if (!school) {
      throw new NotFoundException('School not found');
    }
    if (school.paystackSubaccountCode) {
      throw new ConflictException(
        'A Paystack settlement account is already configured for this school',
      );
    }

    const claimedAt = new Date();
    const staleClaimBefore = new Date(claimedAt.getTime() - 10 * 60 * 1000);
    const claimed = await this.prisma.school.updateMany({
      where: {
        id: schoolId,
        paystackSubaccountCode: null,
        OR: [
          { paystackSubaccountSetupStartedAt: null },
          { paystackSubaccountSetupStartedAt: { lt: staleClaimBefore } },
        ],
      },
      data: { paystackSubaccountSetupStartedAt: claimedAt },
    });
    if (!claimed.count) {
      throw new ConflictException(
        'Settlement setup is already in progress; wait ten minutes before retrying',
      );
    }

    const subaccountCode = await this.paystack.createSubaccount({
      businessName: dto.accountName,
      settlementBank: dto.settlementBank,
      accountNumber: dto.accountNumber,
    });
    const saved = await this.prisma.school.updateMany({
      where: {
        id: schoolId,
        paystackSubaccountCode: null,
        paystackSubaccountSetupStartedAt: claimedAt,
      },
      data: {
        paystackSubaccountCode: subaccountCode,
        paystackSubaccountSetupStartedAt: null,
      },
    });
    if (!saved.count) {
      throw new ConflictException(
        'Settlement configuration changed while processing; contact support before retrying',
      );
    }

    return { configured: true };
  }

  async findOne(id: string, user: RequestUser) {
    if (user.role === UserRole.SUPER_ADMIN) {
      const school = await this.prisma.school.findUnique({
        where: {
          id,
        },
        include: {
          _count: {
            select: {
              students: true,
              teachers: true,
              parents: true,
              classes: true,
              subjects: true,
            },
          },
        },
      });

      if (!school) {
        throw new NotFoundException('School not found');
      }

      return this.formatSchool(school);
    }

    const schoolId = await this.getSchoolId(user);

    if (schoolId !== id) {
      throw new ForbiddenException('You do not have access to this school');
    }

    const school = await this.prisma.school.findUnique({
      where: {
        id,
      },
      include: {
        _count: {
          select: {
            students: true,
            teachers: true,
            parents: true,
            classes: true,
            subjects: true,
          },
        },
      },
    });

    if (!school) {
      throw new NotFoundException('School not found');
    }

    return this.formatSchool(school);
  }

  async updateMine(dto: UpdateSchoolDto, user: RequestUser) {
    this.ensureCanManage(user);

    const schoolId = await this.getSchoolId(user);

    if (dto.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: dto.timezone });
      } catch (error) {
        if (error instanceof RangeError) {
          throw new BadRequestException(
            'timezone must be a valid IANA timezone',
          );
        }
        throw error;
      }
    }

    const school = await this.prisma.school.findUnique({
      where: {
        id: schoolId,
      },
    });

    if (!school) {
      throw new NotFoundException('School not found');
    }

    const updated = await this.prisma.school.update({
      where: {
        id: schoolId,
      },
      data: {
        ...(dto.name !== undefined
          ? {
              name: dto.name,
            }
          : {}),

        ...(dto.email !== undefined
          ? {
              email: dto.email,
            }
          : {}),

        ...(dto.phone !== undefined
          ? {
              phone: dto.phone,
            }
          : {}),

        ...(dto.address !== undefined
          ? {
              address: dto.address,
            }
          : {}),

        ...(dto.website !== undefined
          ? {
              website: dto.website,
            }
          : {}),

        ...(dto.logoUrl !== undefined
          ? {
              logoUrl: dto.logoUrl,
            }
          : {}),

        ...(dto.timezone !== undefined
          ? {
              timezone: dto.timezone,
            }
          : {}),
      },
    });
    return this.formatSchool(updated);
  }

  async updateStatus(id: string, status: SchoolStatus, user: RequestUser) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only super admins can change school status',
      );
    }

    const school = await this.prisma.school.findUnique({
      where: {
        id,
      },
    });

    if (!school) {
      throw new NotFoundException('School not found');
    }

    const updated = await this.prisma.school.update({
      where: {
        id,
      },
      data: {
        status,
      },
    });
    return this.formatSchool(updated);
  }

  async findAll(user: RequestUser) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only super admins can view all schools');
    }

    const schools = await this.prisma.school.findMany({
      include: {
        _count: {
          select: {
            students: true,
            teachers: true,
            parents: true,
            classes: true,
            subjects: true,
          },
        },
        subscription: {
          include: {
            plan: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return schools.map((school) => this.formatSchool(school));
  }
}
