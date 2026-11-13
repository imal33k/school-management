import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { TeacherService } from './teacher.service';

import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';
import { AssignTeacherSubjectDto } from './dto/assign-teacher-subject.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';
import { RequireSchoolAccess } from '../auth/decorator/school-access.decorator';
import { SchoolAccessGuard } from '../auth/guards/school-access.guard';

@Controller('teachers')
export class TeacherController {
  constructor(
    private readonly teacherService: TeacherService,
  ) {}

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  @RequireSchoolAccess()
  @UseGuards(SchoolAccessGuard)
  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateTeacherDto,
  ) {
    return this.teacherService.create(
      user,
      dto,
    );
  }

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  @RequireSchoolAccess()
  @UseGuards(SchoolAccessGuard)
  @Get()
  findAll(

    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.teacherService.findAll(user, query);
  }

  @Roles(UserRole.TEACHER)
  @RequireSchoolAccess()
  @UseGuards(SchoolAccessGuard)
  @Get('me')
  findMe(@CurrentUser() user: RequestUser) {
    return this.teacherService.findMe(user);
  }

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER)
  @RequireSchoolAccess()
  @UseGuards(SchoolAccessGuard)
  @Get(':id')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.teacherService.findOne(
      user,
      id,
    );
  }

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  @RequireSchoolAccess()
  @UseGuards(SchoolAccessGuard)
  @Post(':id/reset-password')
  resetPassword(@CurrentUser() user: RequestUser, @Param('id') id: string) { return this.teacherService.resetPassword(user, id); }

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  @RequireSchoolAccess()
  @UseGuards(SchoolAccessGuard)
  @Post(':id/subjects')
  assignSubject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AssignTeacherSubjectDto,
  ) {
    return this.teacherService.assignSubject(user, id, dto);
  }

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER)
  @RequireSchoolAccess()
  @UseGuards(SchoolAccessGuard)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTeacherDto,
  ) {
    return this.teacherService.update(
      user,
      id,
      dto,
    );
  }

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  @RequireSchoolAccess()
  @UseGuards(SchoolAccessGuard)
  @Delete(':id')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.teacherService.remove(
      user,
      id,
    );
  }
}