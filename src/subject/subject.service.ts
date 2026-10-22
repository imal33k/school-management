import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  RequestUser,
} from '../auth/decorator/current-user.decorator';

import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

@Injectable()
export class SubjectsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private ensureAdmin(user: RequestUser) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only school administrators can manage subjects',
      );
    }
  }

  async create(
    user: RequestUser,
    dto: CreateSubjectDto,
  ) {
    this.ensureAdmin(user);

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

    const existingSubject =
      await this.prisma.subject.findFirst({
        where: {
          schoolId: membership.schoolId,
          name: dto.name,
        },
      });

    if (existingSubject) {
      throw new ConflictException(
        'A subject with this name already exists in this school',
      );
    }

    return this.prisma.subject.create({
      data: {
        schoolId: membership.schoolId,
        name: dto.name,
        code: dto.code,
      },
    });
  }

  async findAll(user: RequestUser) {
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

    return this.prisma.subject.findMany({
      where: {
        schoolId: membership.schoolId,
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

    const subject =
      await this.prisma.subject.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
        include: {
          classAssignments: {
            include: {
              class: true,
            },
          },
          teacherAssignments: {
            include: {
              teacher: true,
            },
          },
        },
      });

    if (!subject) {
      throw new NotFoundException(
        'Subject not found',
      );
    }

    return subject;
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateSubjectDto,
  ) {
    this.ensureAdmin(user);

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

    const subject =
      await this.prisma.subject.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!subject) {
      throw new NotFoundException(
        'Subject not found',
      );
    }

    if (dto.name) {
      const existingSubject =
        await this.prisma.subject.findFirst({
          where: {
            schoolId: membership.schoolId,
            name: dto.name,
            NOT: {
              id,
            },
          },
        });

      if (existingSubject) {
        throw new ConflictException(
          'A subject with this name already exists in this school',
        );
      }
    }

    return this.prisma.subject.update({
      where: {
        id,
      },
      data: {
        name: dto.name,
        code: dto.code,
      },
    });
  }

  async remove(
    user: RequestUser,
    id: string,
  ) {
    this.ensureAdmin(user);

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

    const subject =
      await this.prisma.subject.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!subject) {
      throw new NotFoundException(
        'Subject not found',
      );
    }

    return this.prisma.subject.delete({
      where: {
        id,
      },
    });
  }
}