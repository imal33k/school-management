import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  NotificationType,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import type { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(
    user: RequestUser,
    dto: CreateNotificationDto,
  ) {
    const membership =
      await this.getAdminMembership(user);

    const membershipWhere: any = {
      schoolId: membership.schoolId,
      ...(dto.recipientUserIds?.length ? { userId: { in: dto.recipientUserIds } } : {}),
      ...(dto.recipientRoles?.length ? { role: { in: dto.recipientRoles } } : {}),
    };
    const recipients = await this.prisma.schoolMembership.findMany({ where: membershipWhere, select: { userId: true } });
    if (!recipients.length) throw new NotFoundException('No notification recipients were found in this school');
    return this.prisma.notification.create({
      data: {
        schoolId: membership.schoolId,
        title: dto.title,
        message: dto.message,
        type: dto.type,
        recipients: { create: recipients.map(({ userId }) => ({ userId })) },
      },
      include: { recipients: true },
    });
  }

  async findAll(user: RequestUser) {
    const membership =
      await this.getMembership(user);

    return this.prisma.notification.findMany({
      where: {
        schoolId: membership.schoolId,
      },
      include: {
        recipients: true,
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

    const notification =
      await this.prisma.notification.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
        include: {
          recipients: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  role: true,
                },
              },
            },
          },
        },
      });

    if (!notification) {
      throw new NotFoundException(
        'Notification not found',
      );
    }

    return notification;
  }

  async markAsRead(
    user: RequestUser,
    notificationId: string,
  ) {
    const recipient =
      await this.prisma.notificationRecipient.findFirst({
        where: {
          notificationId,
          userId: user.id,
          notification: {
            schoolId: (
              await this.getMembership(user)
            ).schoolId,
          },
        },
      });

    if (!recipient) {
      throw new NotFoundException(
        'Notification not found',
      );
    }

    return this.prisma.notificationRecipient.update({
      where: {
        id: recipient.id,
      },
      data: {
        readAt: new Date(),
      },
    });
  }

  async myNotifications(
    user: RequestUser,
  ) {
    return this.prisma.notificationRecipient.findMany({
      where: {
        userId: user.id,
      },
      include: {
        notification: true,
      },
      orderBy: {
        notification: {
          createdAt: 'desc',
        },
      },
    });
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
        'Only school administrators can manage notifications',
      );
    }

    return this.getMembership(user);
  }
}