import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { NotificationService } from './notifications.service';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

import { CreateNotificationDto } from './dto/create-notification.dto';

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
  ) {}

  @Post()
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
  findAll(
    @CurrentUser() user: RequestUser,
  ) {
    return this.notificationService.findAll(user);
  }

  @Get('me')
  myNotifications(
    @CurrentUser() user: RequestUser,
  ) {
    return this.notificationService.myNotifications(
      user,
    );
  }

  @Get(':id')
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