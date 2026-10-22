import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import {
  RequestUser,
} from '../auth/decorator/current-user.decorator';

import { UserRole } from '@prisma/client';

import { CreateAcademicSessionDto } from './dto/create-academic-session.dto';
import { UpdateAcademicSessionDto } from './dto/update-academic-session.dto';

@Injectable()
export class AcademicSessionService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private ensureAdmin(user: RequestUser) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only school administrators can manage academic sessions',
      );
    }
  }

  private async getMembership(user: RequestUser) {
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'You are not a member of any school',
      );
    }

    return membership;
  }

  async create(
    user: RequestUser,
    dto: CreateAcademicSessionDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (startDate >= endDate) {
      throw new BadRequestException(
        'Start date must be before end date',
      );
    }

    const existingSession =
      await this.prisma.academicSession.findFirst({
        where: {
          schoolId: membership.schoolId,
          name: dto.name,
        },
      });

    if (existingSession) {
      throw new ConflictException(
        'An academic session with this name already exists in this school',
      );
    }

    return this.prisma.academicSession.create({
      data: {
        schoolId: membership.schoolId,
        name: dto.name,
        startDate,
        endDate,
        isActive: false,
      },
    });
  }

  async findAll(user: RequestUser) {
    const membership =
      await this.getMembership(user);

    return this.prisma.academicSession.findMany({
      where: {
        schoolId: membership.schoolId,
      },
      include: {
        terms: true,
      },
      orderBy: {
        startDate: 'desc',
      },
    });
  }

  async findOne(
    id: string,
    user: RequestUser,
  ) {
    const membership =
      await this.getMembership(user);

    const session =
      await this.prisma.academicSession.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
        include: {
          terms: {
            orderBy: {
              startDate: 'asc',
            },
          },
          classes: true,
        },
      });

    if (!session) {
      throw new NotFoundException(
        'Academic session not found',
      );
    }

    return session;
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateAcademicSessionDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const session =
      await this.prisma.academicSession.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!session) {
      throw new NotFoundException(
        'Academic session not found',
      );
    }

    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : session.startDate;

    const endDate = dto.endDate
      ? new Date(dto.endDate)
      : session.endDate;

    if (startDate >= endDate) {
      throw new BadRequestException(
        'Start date must be before end date',
      );
    }

    if (dto.name && dto.name !== session.name) {
      const existingSession =
        await this.prisma.academicSession.findFirst({
          where: {
            schoolId: membership.schoolId,
            name: dto.name,
            NOT: {
              id,
            },
          },
        });

      if (existingSession) {
        throw new ConflictException(
          'An academic session with this name already exists in this school',
        );
      }
    }

    return this.prisma.academicSession.update({
      where: {
        id,
      },
      data: {
        name: dto.name,
        startDate,
        endDate,
      },
    });
  }

  async remove(
    user: RequestUser,
    id: string,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const session =
      await this.prisma.academicSession.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!session) {
      throw new NotFoundException(
        'Academic session not found',
      );
    }

    if (session.isActive) {
      throw new BadRequestException(
        'The active academic session cannot be deleted',
      );
    }

    return this.prisma.academicSession.delete({
      where: {
        id,
      },
    });
  }

  async activate(
    user: RequestUser,
    id: string,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const session =
      await this.prisma.academicSession.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!session) {
      throw new NotFoundException(
        'Academic session not found',
      );
    }

    return this.prisma.$transaction([
      this.prisma.academicSession.updateMany({
        where: {
          schoolId: membership.schoolId,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      }),

      this.prisma.academicSession.update({
        where: {
          id,
        },
        data: {
          isActive: true,
        },
      }),
    ]);
  }
}