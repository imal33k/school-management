import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { TimetableService } from './timetable-entry.module';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';

import { CreateTimetableEntryDto } from './dto/create-timetable-entry.dto';
import { UpdateTimetableEntryDto } from './dto/update-timetable-entry.dto';

@Controller('timetable')
export class TimetableController {
  constructor(
    private readonly timetableService: TimetableService,
  ) {}

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateTimetableEntryDto,
  ) {
    return this.timetableService.create(user, dto);
  }

  @Get()
  @Roles(
    UserRole.SCHOOL_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  findAll(
    @CurrentUser() user: RequestUser,
  ) {
    return this.timetableService.findAll(user);
  }

  @Get(':id')
  @Roles(
    UserRole.SCHOOL_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.TEACHER,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.timetableService.findOne(user, id);
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTimetableEntryDto,
  ) {
    return this.timetableService.update(
      user,
      id,
      dto,
    );
  }

  @Delete(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.timetableService.remove(user, id);
  }
}
