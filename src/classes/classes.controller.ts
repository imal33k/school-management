import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

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

@Controller('classes')
export class ClassesController {
  constructor(
    private readonly classesService: ClassesService,
  ) {}

  @Post()
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
  findAll(
    @CurrentUser() user: RequestUser,
  ) {
    return this.classesService.findAll(user);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.classesService.findOne(id, user);
  }

  @Patch(':id')
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
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.classesService.remove(user, id);
  }

  @Post(':id/teachers')
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

  @Post(':id/subjects')
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

  @Post(':id/students')
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