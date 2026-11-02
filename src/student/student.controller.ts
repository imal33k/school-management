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
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { StudentService } from './student.service';

import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';

@Controller('students')
export class StudentController {
  constructor(
    private readonly studentService: StudentService,
  ) {}

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateStudentDto,
  ) {
    return this.studentService.create(
      user,
      dto,
    );
  }

  @Roles(UserRole.STUDENT)
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.studentService.findMe(user);
  }

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER)
  @Get('class/:classId')
  findByClass(
    @CurrentUser() user: RequestUser,
    @Param('classId') classId: string,
  ) {
    return this.studentService.findByClass(user, classId);
  }

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER)
  @Get()
  findAll(

    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.studentService.findAll(user, query);
  }

  @Roles(
    UserRole.SCHOOL_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
  )
  @Get(':id')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.studentService.findOne(
      user,
      id,
    );
  }

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.studentService.update(
      user,
      id,
      dto,
    );
  }

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  @Delete(':id')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.studentService.remove(
      user,
      id,
    );
  }
}