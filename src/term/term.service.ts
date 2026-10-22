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

import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';

@Injectable()
export class TermService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private ensureAdmin(user: RequestUser) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only school administrators can manage terms',
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

  private async getSession(
    sessionId: string,
    schoolId: string,
  ) {
    const session =
      await this.prisma.academicSession.findFirst({
        where: {
          id: sessionId,
          schoolId,
        },
      });

    if (!session) {
      throw new NotFoundException(
        'Academic session not found',
      );
    }

    return session;
  }

  async create(
    user: RequestUser,
    sessionId: string,
    dto: CreateTermDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const session = await this.getSession(
      sessionId,
      membership.schoolId,
    );

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (startDate >= endDate) {
      throw new BadRequestException(
        'Term start date must be before end date',
      );
    }

    if (
      startDate < session.startDate ||
      endDate > session.endDate
    ) {
      throw new BadRequestException(
        'Term dates must fall within the academic session dates',
      );
    }

    const existingTerm =
      await this.prisma.term.findFirst({
        where: {
          academicSessionId: session.id,
          type: dto.type,
        },
      });

    if (existingTerm) {
      throw new ConflictException(
        'A term with this type already exists in this academic session',
      );
    }

    return this.prisma.term.create({
      data: {
        academicSessionId: session.id,
        name: dto.name,
        type: dto.type,
        startDate,
        endDate,
        isActive: false,
      },
    });
  }

  async findAll(
    user: RequestUser,
    sessionId: string,
  ) {
    const membership =
      await this.getMembership(user);

    const session = await this.getSession(
      sessionId,
      membership.schoolId,
    );

    return this.prisma.term.findMany({
      where: {
        academicSessionId: session.id,
      },
      orderBy: {
        startDate: 'asc',
      },
    });
  }

  async findOne(
    user: RequestUser,
    id: string,
  ) {
    const membership =
      await this.getMembership(user);

    const term =
      await this.prisma.term.findFirst({
        where: {
          id,
          academicSession: {
            schoolId: membership.schoolId,
          },
        },
        include: {
          academicSession: true,
          examinations: true,
          feeStructures: true,
          results: true,
        },
      });

    if (!term) {
      throw new NotFoundException(
        'Term not found',
      );
    }

    return term;
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateTermDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const term =
      await this.prisma.term.findFirst({
        where: {
          id,
          academicSession: {
            schoolId: membership.schoolId,
          },
        },
        include: {
          academicSession: true,
        },
      });

    if (!term) {
      throw new NotFoundException(
        'Term not found',
      );
    }

    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : term.startDate;

    const endDate = dto.endDate
      ? new Date(dto.endDate)
      : term.endDate;

    if (startDate >= endDate) {
      throw new BadRequestException(
        'Term start date must be before end date',
      );
    }

    if (
      startDate < term.academicSession.startDate ||
      endDate > term.academicSession.endDate
    ) {
      throw new BadRequestException(
        'Term dates must fall within the academic session dates',
      );
    }

    if (
      dto.type &&
      dto.type !== term.type
    ) {
      const existingTerm =
        await this.prisma.term.findFirst({
          where: {
            academicSessionId:
              term.academicSessionId,
            type: dto.type,
            NOT: {
              id,
            },
          },
        });

      if (existingTerm) {
        throw new ConflictException(
          'A term with this type already exists in this academic session',
        );
      }
    }

    return this.prisma.term.update({
      where: {
        id,
      },
      data: {
        name: dto.name,
        type: dto.type,
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

    const term =
      await this.prisma.term.findFirst({
        where: {
          id,
          academicSession: {
            schoolId: membership.schoolId,
          },
        },
      });

    if (!term) {
      throw new NotFoundException(
        'Term not found',
      );
    }

    if (term.isActive) {
      throw new BadRequestException(
        'The active term cannot be deleted',
      );
    }

    return this.prisma.term.delete({
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

    const term =
      await this.prisma.term.findFirst({
        where: {
          id,
          academicSession: {
            schoolId: membership.schoolId,
          },
        },
        include: {
          academicSession: true,
        },
      });

    if (!term) {
      throw new NotFoundException(
        'Term not found',
      );
    }

    if (!term.academicSession.isActive) {
      throw new BadRequestException(
        'The academic session must be active before activating a term',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        await tx.term.updateMany({
          where: {
            academicSessionId:
              term.academicSessionId,
            isActive: true,
          },
          data: {
            isActive: false,
          },
        });

        return tx.term.update({
          where: {
            id,
          },
          data: {
            isActive: true,
          },
        });
      },
    );
  }
}