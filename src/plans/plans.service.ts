import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  Prisma,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreatePlanDto } from './dto/create-plan-status.dto';
import { UpdatePlanDto } from './dto/update-plan-status.dto';
import { UpdatePlanStatusDto } from './dto/plan-status.dto';

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private ensureSuperAdmin(
    user: RequestUser,
  ) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only super admins can manage plans',
      );
    }
  }

  async create(
    dto: CreatePlanDto,
    user: RequestUser,
  ) {
    this.ensureSuperAdmin(user);

    const existing =
      await this.prisma.plan.findUnique({
        where: {
          name: dto.name,
        },
      });

    if (existing) {
      throw new ConflictException(
        'A plan with this name already exists',
      );
    }

    return this.prisma.plan.create({
      data: {
        name: dto.name,
        description: dto.description,
        price: new Prisma.Decimal(
          dto.price,
        ),
        billingInterval:
          dto.billingInterval,
        maxStudents:
          dto.maxStudents,
        maxTeachers:
          dto.maxTeachers,
        maxParents:
          dto.maxParents,
      },
    });
  }

  async findAll(
    user: RequestUser,
  ) {
    this.ensureSuperAdmin(user);

    return this.prisma.plan.findMany({
      include: {
        _count: {
          select: {
            subscriptions: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findActivePlans() {
    return this.prisma.plan.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        price: 'asc',
      },
    });
  }

  async findOne(
    id: string,
    user: RequestUser,
  ) {
    this.ensureSuperAdmin(user);

    const plan =
      await this.prisma.plan.findUnique({
        where: {
          id,
        },
        include: {
          _count: {
            select: {
              subscriptions: true,
            },
          },
        },
      });

    if (!plan) {
      throw new NotFoundException(
        'Plan not found',
      );
    }

    return plan;
  }

  async update(
    id: string,
    dto: UpdatePlanDto,
    user: RequestUser,
  ) {
    this.ensureSuperAdmin(user);

    const plan =
      await this.prisma.plan.findUnique({
        where: {
          id,
        },
      });

    if (!plan) {
      throw new NotFoundException(
        'Plan not found',
      );
    }

    if (dto.name !== undefined) {
      const duplicate =
        await this.prisma.plan.findFirst({
          where: {
            name: dto.name,
            id: {
              not: id,
            },
          },
        });

      if (duplicate) {
        throw new ConflictException(
          'A plan with this name already exists',
        );
      }
    }

    return this.prisma.plan.update({
      where: {
        id,
      },
      data: {
        ...(dto.name !== undefined
          ? {
              name: dto.name,
            }
          : {}),

        ...(dto.description !== undefined
          ? {
              description:
                dto.description,
            }
          : {}),

        ...(dto.price !== undefined
          ? {
              price: new Prisma.Decimal(
                dto.price,
              ),
            }
          : {}),

        ...(dto.billingInterval !==
        undefined
          ? {
              billingInterval:
                dto.billingInterval,
            }
          : {}),

        ...(dto.maxStudents !==
        undefined
          ? {
              maxStudents:
                dto.maxStudents,
            }
          : {}),

        ...(dto.maxTeachers !==
        undefined
          ? {
              maxTeachers:
                dto.maxTeachers,
            }
          : {}),

        ...(dto.maxParents !==
        undefined
          ? {
              maxParents:
                dto.maxParents,
            }
          : {}),
      },
    });
  }

  async updateStatus(
    id: string,
    dto: UpdatePlanStatusDto,
    user: RequestUser,
  ) {
    this.ensureSuperAdmin(user);

    const plan =
      await this.prisma.plan.findUnique({
        where: {
          id,
        },
      });

    if (!plan) {
      throw new NotFoundException(
        'Plan not found',
      );
    }

    return this.prisma.plan.update({
      where: {
        id,
      },
      data: {
        isActive: dto.isActive,
      },
    });
  }

  async remove(
    id: string,
    user: RequestUser,
  ) {
    this.ensureSuperAdmin(user);

    const plan =
      await this.prisma.plan.findUnique({
        where: {
          id,
        },
        include: {
          _count: {
            select: {
              subscriptions: true,
            },
          },
        },
      });

    if (!plan) {
      throw new NotFoundException(
        'Plan not found',
      );
    }

    if (plan._count.subscriptions > 0) {
      throw new ConflictException(
        'Plan cannot be deleted because subscriptions already exist for it',
      );
    }

    await this.prisma.plan.delete({
      where: {
        id,
      },
    });

    return {
      message:
        'Plan deleted successfully',
    };
  }
}