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

import { ClassesService } from './classes.service';

import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { AssignTeacherDto } from './dto/assign-teacher.dto';
import { AssignSubjectDto } from './dto/assign-subject.dto';
import { EnrollStudentDto } from './dto/enroll-class.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';

@Controller('classes')
export class ClassesController {
  constructor(
    private readonly classesService: ClassesService,
  ) {}

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  create(
    @CurrentUser() user: RequestUser,
    @Body() createClassDto: CreateClassDto,
  ) {
    return this.classesService.create(
      user,
      createClassDto,
    );
  }

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER)
  findAll(
    @CurrentUser() user: RequestUser,
  ) {
    return this.classesService.findAll(user);
  }

  @Get(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER)
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.classesService.findOne(id, user);
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() updateClassDto: UpdateClassDto,
  ) {
    return this.classesService.update(
      user,
      id,
      updateClassDto,
    );
  }

  @Delete(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.classesService.remove(user, id);
  }

  @Post(':id/teachers')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  assignTeacher(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AssignTeacherDto,
  ) {
    return this.classesService.assignTeacher(
      user,
      id,
      dto,
    );
  }

  @Patch(':id/teachers/:teacherId/primary')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  setPrimaryTeacher(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('teacherId') teacherId: string,
  ) {
    return this.classesService.setPrimaryTeacher(user, id, teacherId);
  }

  @Delete(':id/teachers/:teacherId')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  unassignTeacher(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('teacherId') teacherId: string,
  ) {
    return this.classesService.unassignTeacher(user, id, teacherId);
  }

  @Post(':id/subjects')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  assignSubject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AssignSubjectDto,
  ) {
    return this.classesService.assignSubject(
      user,
      id,
      dto,
    );
  }

  @Delete(':id/subjects/:subjectId')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  unassignSubject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('subjectId') subjectId: string,
  ) {
    return this.classesService.unassignSubject(user, id, subjectId);
  }

  @Post(':id/students')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  enrollStudent(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: EnrollStudentDto,
  ) {
    return this.classesService.enrollStudent(
      user,
      id,
      dto,
    );
  }
}