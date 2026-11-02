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

import { SubjectsService } from './subject.service';

import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';

@Controller('subject')
export class SubjectController {
  constructor(
    private readonly subjectService: SubjectsService,
  ) {}

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSubjectDto,
  ) {
    return this.subjectService.create(
      user,
      dto,
    );
  }

  @Get()
  @Roles(
    UserRole.SCHOOL_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.TEACHER,
    UserRole.ACCOUNTANT,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  findAll(
    @CurrentUser() user: RequestUser,
  ) {
    return this.subjectService.findAll(user);
  }

  @Get(':id')
  @Roles(
    UserRole.SCHOOL_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.TEACHER,
    UserRole.ACCOUNTANT,
    UserRole.PARENT,
    UserRole.STUDENT,
  )
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.subjectService.findOne(
      id,
      user,
    );
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() updateSubjectDto: UpdateSubjectDto,
  ) {
    return this.subjectService.update(
      user,
      id,
      updateSubjectDto,
    );
  }

  @Delete(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.subjectService.remove(
      user,
      id,
    );
  }
}