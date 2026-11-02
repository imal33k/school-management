import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AnnouncementAudience,
  Prisma,
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
    const where = await this.getAnnouncementVisibility(user, membership.schoolId);

    return this.prisma.announcement.findMany({
      where,
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
    const visibility = await this.getAnnouncementVisibility(
      user,
      membership.schoolId,
    );

    const announcement =
      await this.prisma.announcement.findFirst({
        where: {
          id,
          ...visibility,
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
          ...(user.schoolId ? { schoolId: user.schoolId } : {}),
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

  private async getAnnouncementVisibility(
    user: RequestUser,
    schoolId: string,
  ): Promise<Prisma.AnnouncementWhereInput> {
    if (
      user.role === UserRole.SCHOOL_ADMIN ||
      user.role === UserRole.SUPER_ADMIN
    ) {
      return { schoolId };
    }

    let audience: AnnouncementAudience;
    let classIds: string[] = [];

    if (user.role === UserRole.TEACHER) {
      audience = AnnouncementAudience.TEACHERS;
      const teacher = await this.prisma.teacher.findUnique({
        where: { userId: user.id },
        include: { classAssignments: { select: { classId: true } } },
      });
      if (!teacher) {
        throw new ForbiddenException('Teacher profile not found');
      }
      classIds = teacher.classAssignments.map(
        (assignment) => assignment.classId,
      );
    } else if (user.role === UserRole.STUDENT) {
      audience = AnnouncementAudience.STUDENTS;
      const student = await this.prisma.student.findFirst({
        where: { userId: user.id, schoolId },
        include: {
          enrollments: {
            where: { status: 'ACTIVE' },
            select: { classId: true },
          },
        },
      });
      if (!student) {
        throw new ForbiddenException('Student profile not found');
      }
      classIds = student.enrollments.map(
        (enrollment) => enrollment.classId,
      );
    } else if (user.role === UserRole.PARENT) {
      audience = AnnouncementAudience.PARENTS;
      const parent = await this.prisma.parent.findFirst({
        where: { userId: user.id, schoolId },
        include: {
          children: {
            where: { student: { schoolId } },
            include: {
              student: {
                include: {
                  enrollments: {
                    where: { status: 'ACTIVE' },
                    select: { classId: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!parent) {
        throw new ForbiddenException('Parent profile not found');
      }
      classIds = parent.children.flatMap((child) =>
        child.student.enrollments.map((enrollment) => enrollment.classId),
      );
    } else if (user.role === UserRole.ACCOUNTANT) {
      audience = AnnouncementAudience.ACCOUNTANTS;
    } else {
      throw new ForbiddenException(
        'You are not allowed to view announcements',
      );
    }

    const audienceConditions: Prisma.AnnouncementWhereInput[] = [
      { audience: AnnouncementAudience.ALL },
      { audience },
    ];
    if (classIds.length) {
      audienceConditions.push({
        audience: AnnouncementAudience.SPECIFIC_CLASS,
        classId: { in: classIds },
      });
    }

    return {
      schoolId,
      published: true,
      OR: audienceConditions,
    };
  }
}