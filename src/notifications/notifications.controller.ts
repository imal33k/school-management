import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { NotificationService } from './notifications.service';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';

import { CreateNotificationDto } from './dto/create-notification.dto';

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
  ) {}

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateNotificationDto,
  ) {
    return this.notificationService.create(
      user,
      dto,
    );
  }

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  findAll(
    @CurrentUser() user: RequestUser,
  ) {
    return this.notificationService.findAll(user);
  }

  @Get('me')
  @Roles(
    UserRole.SCHOOL_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.TEACHER,
    UserRole.ACCOUNTANT,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  myNotifications(
    @CurrentUser() user: RequestUser,
  ) {
    return this.notificationService.myNotifications(
      user,
    );
  }

  @Get(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.notificationService.findOne(
      user,
      id,
    );
  }

  @Patch(':id/read')
  @Roles(
    UserRole.SCHOOL_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.TEACHER,
    UserRole.ACCOUNTANT,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  markAsRead(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.notificationService.markAsRead(
      user,
      id,
    );
  }
}