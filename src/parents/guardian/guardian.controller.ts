import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { GuardianService } from './guardian.service';
import { TimetableService } from '../../timetable-entry/timetable-entry.service';

import { CreateParentDto } from './dto/create-guardian.dto';
import { UpdateParentDto } from './dto/update-guardian.dto';
import { LinkStudentDto } from './dto/link-student.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../../auth/decorator/current-user.decorator';
import { Roles } from '../../auth/decorator/roles.decorator';

@Controller('parents')
export class GuardianController {
  constructor(
    private readonly parentService: GuardianService,
    private readonly timetableService: TimetableService,
  ) {}

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateParentDto,
  ) {
    return this.parentService.create(
      user,
      dto,
    );
  }

  @Get('me')
  @Roles(UserRole.PARENT)
  me(@CurrentUser() user: RequestUser) 
  { return this.parentService.findMe(user); }

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  findAll(

    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.parentService.findAll(user, query);
  }

  @Get(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN, UserRole.PARENT)
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.parentService.findOne(
      user,
      id,
    );
  }

  @Get('me/children/:studentId')
  @Roles(UserRole.PARENT)
  async findMyChild(
    @CurrentUser() user: RequestUser,
    @Param('studentId') studentId: string,
  ){
    return this.parentService.findMyChild(user, studentId);
  }

  @Get('me/children/:studentId/timetable')
  @Roles(UserRole.PARENT)
  findMyChildTimetable(
    @CurrentUser() user: RequestUser,
    @Param('studentId') studentId: string,
  ) {
    return this.timetableService.findChildTimetable(user, studentId);
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateParentDto,
  ) {
    return this.parentService.update(
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
    return this.parentService.remove(
      user,
      id,
    );
  }

  @Post(':id/students')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  linkStudent(
    @CurrentUser() user: RequestUser,
    @Param('id') parentId: string,
    @Body() dto: LinkStudentDto,
  ) {
    return this.parentService.linkStudent(
      user,
      parentId,
      dto,
    );
  }

  @Delete(':id/students/:studentId')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  unlinkStudent(
    @CurrentUser() user: RequestUser,
    @Param('id') parentId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.parentService.unlinkStudent(
      user,
      parentId,
      studentId,
    );
  }
}
