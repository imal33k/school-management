import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, type RequestUser } from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';

import { ClassLevelsService } from './class-levels.service';
import { AssignLevelDto, CreateClassLevelDto, UpdateClassLevelDto } from './dto/class-level.dto';

@Controller('class-levels')
export class ClassLevelsController {
  constructor(private readonly service: ClassLevelsService) {}

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT)
  findAll(@CurrentUser() user: RequestUser) {
    return this.service.findAll(user);
  }

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN)
  create(@Body() dto: CreateClassLevelDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  // Primary 1 ... SS 3 in one click, for a school with no levels yet
  @Post('defaults')
  @Roles(UserRole.SCHOOL_ADMIN)
  createDefaults(@CurrentUser() user: RequestUser) {
    return this.service.createDefaults(user);
  }

  // Put classes into a level. Stays ABOVE ':id' routes.
  @Put('assign')
  @Roles(UserRole.SCHOOL_ADMIN)
  assign(@Body() dto: AssignLevelDto, @CurrentUser() user: RequestUser) {
    return this.service.assign(dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateClassLevelDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }
}
