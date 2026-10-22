import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  Prisma,
  SchoolStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

import { UpdateSchoolDto } from './dto/update-school.dto';

@Injectable()
export class SchoolsService {
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
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'You do not have permission to manage school information',
      );
    }
  }

  async findMine(
    user: RequestUser,
  ) {
    const schoolId =
      await this.getSchoolId(user);

    const school =
      await this.prisma.school.findUnique({
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
      throw new NotFoundException(
        'School not found',
      );
    }

    return school;
  }

  async findOne(
    id: string,
    user: RequestUser,
  ) {
    if (user.role === UserRole.SUPER_ADMIN) {
      const school =
        await this.prisma.school.findUnique({
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
        throw new NotFoundException(
          'School not found',
        );
      }

      return school;
    }

    const schoolId =
      await this.getSchoolId(user);

    if (schoolId !== id) {
      throw new ForbiddenException(
        'You do not have access to this school',
      );
    }

    const school =
      await this.prisma.school.findUnique({
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
      throw new NotFoundException(
        'School not found',
      );
    }

    return school;
  }

  async updateMine(
    dto: UpdateSchoolDto,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const schoolId =
      await this.getSchoolId(user);

    const school =
      await this.prisma.school.findUnique({
        where: {
          id: schoolId,
        },
      });

    if (!school) {
      throw new NotFoundException(
        'School not found',
      );
    }

    return this.prisma.school.update({
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
      },
    });
  }

  async updateStatus(
    id: string,
    status: SchoolStatus,
    user: RequestUser,
  ) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only super admins can change school status',
      );
    }

    const school =
      await this.prisma.school.findUnique({
        where: {
          id,
        },
      });

    if (!school) {
      throw new NotFoundException(
        'School not found',
      );
    }

    return this.prisma.school.update({
      where: {
        id,
      },
      data: {
        status,
      },
    });
  }

  async findAll(
    user: RequestUser,
  ) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only super admins can view all schools',
      );
    }

    return this.prisma.school.findMany({
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
  }
}