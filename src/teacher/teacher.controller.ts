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

import { TeacherService } from './teacher.service';

import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

@Controller('teachers')
export class TeacherController {
  constructor(
    private readonly teacherService: TeacherService,
  ) {}

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

  @Get()
  findAll(

    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.teacherService.findAll(user, query);
  }

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

  @Post(':id/reset-password')
  resetPassword(@CurrentUser() user: RequestUser, @Param('id') id: string) { return this.teacherService.resetPassword(user, id); }

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