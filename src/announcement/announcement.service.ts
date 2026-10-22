import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AnnouncementAudience,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import type { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Injectable()
export class AnnouncementService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(
    user: RequestUser,
    dto: CreateAnnouncementDto,
  ) {
    const membership =
      await this.getAdminMembership(user);

    if (dto.classId) {
      await this.validateClass(
        dto.classId,
        membership.schoolId,
      );
    }

    return this.prisma.announcement.create({
      data: {
        schoolId: membership.schoolId,
        classId: dto.classId,
        title: dto.title,
        content: dto.content,
        audience: dto.audience,
        published: dto.published ?? false,
        publishedAt:
          dto.published === true
            ? new Date()
            : null,
      },
      include: {
        class: true,
      },
    });
  }

  async findAll(user: RequestUser) {
    const membership =
      await this.getMembership(user);

    return this.prisma.announcement.findMany({
      where: {
        schoolId: membership.schoolId,
      },
      include: {
        class: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(
    user: RequestUser,
    id: string,
  ) {
    const membership =
      await this.getMembership(user);

    const announcement =
      await this.prisma.announcement.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
        include: {
          class: true,
        },
      });

    if (!announcement) {
      throw new NotFoundException(
        'Announcement not found',
      );
    }

    return announcement;
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateAnnouncementDto,
  ) {
    const membership =
      await this.getAdminMembership(user);

    const existing =
      await this.prisma.announcement.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!existing) {
      throw new NotFoundException(
        'Announcement not found',
      );
    }

    if (dto.classId) {
      await this.validateClass(
        dto.classId,
        membership.schoolId,
      );
    }

    const isPublishing =
      dto.published === true &&
      !existing.published;

    return this.prisma.announcement.update({
      where: {
        id,
      },
      data: {
        ...(dto.title !== undefined && {
          title: dto.title,
        }),
        ...(dto.content !== undefined && {
          content: dto.content,
        }),
        ...(dto.audience !== undefined && {
          audience: dto.audience,
        }),
        ...(dto.classId !== undefined && {
          classId: dto.classId,
        }),
        ...(dto.published !== undefined && {
          published: dto.published,
        }),
        ...(isPublishing && {
          publishedAt: new Date(),
        }),
      },
      include: {
        class: true,
      },
    });
  }

  async remove(
    user: RequestUser,
    id: string,
  ) {
    const membership =
      await this.getAdminMembership(user);

    const announcement =
      await this.prisma.announcement.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!announcement) {
      throw new NotFoundException(
        'Announcement not found',
      );
    }

    await this.prisma.announcement.delete({
      where: {
        id,
      },
    });

    return {
      message:
        'Announcement deleted successfully',
    };
  }

  private async validateClass(
    classId: string,
    schoolId: string,
  ) {
    const schoolClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          id: classId,
          schoolId,
        },
      });

    if (!schoolClass) {
      throw new NotFoundException(
        'Class not found in your school',
      );
    }
  }

  private async getMembership(
    user: RequestUser,
  ) {
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
        },
      });

    if (!membership) {
      throw new ForbiddenException(
        'You do not belong to a school',
      );
    }

    return membership;
  }

  private async getAdminMembership(
    user: RequestUser,
  ) {
    if (user.role !== UserRole.SCHOOL_ADMIN) {
      throw new ForbiddenException(
        'Only school administrators can manage announcements',
      );
    }

    return this.getMembership(user);
  }
}