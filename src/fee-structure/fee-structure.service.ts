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

import { CreateFeeStructureDto } from './dto/create-fee-structure.dto';
import { UpdateFeeStructureDto } from './dto/update-fee-structure.dto';

@Injectable()
export class FeeStructuresService {
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
        'You do not have permission to manage fee structures',
      );
    }
  }

  async create(
    dto: CreateFeeStructureDto,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const schoolId =
      await this.getSchoolId(user);

    const term =
      await this.prisma.term.findFirst({
        where: {
          id: dto.termId,
          academicSession: {
            schoolId,
          },
        },
      });

    if (!term) {
      throw new NotFoundException(
        'Term not found',
      );
    }

    const existing =
      await this.prisma.feeStructure.findFirst({
        where: {
          schoolId,
          termId: term.id,
          name: dto.name,
        },
      });

    if (existing) {
      throw new ConflictException(
        'A fee structure with this name already exists for this term',
      );
    }

    return this.prisma.feeStructure.create({
      data: {
        schoolId,
        termId: term.id,
        name: dto.name,
        amount: new Prisma.Decimal(dto.amount),
        description: dto.description,
      },
      include: {
        term: {
          include: {
            academicSession: true,
          },
        },
      },
    });
  }

  async findAll(
    user: RequestUser,
  ) {
    const schoolId =
      await this.getSchoolId(user);

    return this.prisma.feeStructure.findMany({
      where: {
        schoolId,
      },
      include: {
        term: {
          include: {
            academicSession: true,
          },
        },
      },
      orderBy: [
        {
          createdAt: 'desc',
        },
      ],
    });
  }

  async findByTerm(
    termId: string,
    user: RequestUser,
  ) {
    const schoolId =
      await this.getSchoolId(user);

    const term =
      await this.prisma.term.findFirst({
        where: {
          id: termId,
          academicSession: {
            schoolId,
          },
        },
      });

    if (!term) {
      throw new NotFoundException(
        'Term not found',
      );
    }

    return this.prisma.feeStructure.findMany({
      where: {
        schoolId,
        termId,
      },
      include: {
        term: {
          include: {
            academicSession: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(
    id: string,
    user: RequestUser,
  ) {
    const schoolId =
      await this.getSchoolId(user);

    const feeStructure =
      await this.prisma.feeStructure.findFirst({
        where: {
          id,
          schoolId,
        },
        include: {
          term: {
            include: {
              academicSession: true,
            },
          },
          invoices: true,
        },
      });

    if (!feeStructure) {
      throw new NotFoundException(
        'Fee structure not found',
      );
    }

    return feeStructure;
  }

  async update(
    id: string,
    dto: UpdateFeeStructureDto,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const schoolId =
      await this.getSchoolId(user);

    const feeStructure =
      await this.prisma.feeStructure.findFirst({
        where: {
          id,
          schoolId,
        },
      });

    if (!feeStructure) {
      throw new NotFoundException(
        'Fee structure not found',
      );
    }

    if (dto.name !== undefined) {
      const duplicate =
        await this.prisma.feeStructure.findFirst({
          where: {
            id: {
              not: id,
            },
            schoolId,
            termId: feeStructure.termId,
            name: dto.name,
          },
        });

      if (duplicate) {
        throw new ConflictException(
          'A fee structure with this name already exists for this term',
        );
      }
    }

    return this.prisma.feeStructure.update({
      where: {
        id,
      },
      data: {
        ...(dto.name !== undefined
          ? {
              name: dto.name,
            }
          : {}),

        ...(dto.amount !== undefined
          ? {
              amount: new Prisma.Decimal(
                dto.amount,
              ),
            }
          : {}),

        ...(dto.description !== undefined
          ? {
              description: dto.description,
            }
          : {}),
      },
      include: {
        term: {
          include: {
            academicSession: true,
          },
        },
      },
    });
  }

  async remove(
    id: string,
    user: RequestUser,
  ) {
    this.ensureCanManage(user);

    const schoolId =
      await this.getSchoolId(user);

    const feeStructure =
      await this.prisma.feeStructure.findFirst({
        where: {
          id,
          schoolId,
        },
        include: {
          invoices: true,
        },
      });

    if (!feeStructure) {
      throw new NotFoundException(
        'Fee structure not found',
      );
    }

    if (feeStructure.invoices.length > 0) {
      throw new ConflictException(
        'Fee structure cannot be deleted because invoices already exist for it',
      );
    }

    await this.prisma.feeStructure.delete({
      where: {
        id,
      },
    });

    return {
      message:
        'Fee structure deleted successfully',
    };
  }
}