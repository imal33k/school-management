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

import { ExaminationsService } from './examination.service';

import { CreateExaminationDto } from './dto/create-examination.dto';
import { UpdateExaminationDto } from './dto/update-examination.dto';
import { ExamSubject } from './dto/exam-subject.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

@Controller('examinations')
export class ExaminationsController {
  constructor(
    private readonly examinationsService: ExaminationsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateExaminationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.examinationsService.create(
      dto,
      user,
    );
  }

  @Get()
  findAll(

    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.examinationsService.findAll(
      user, query,
    );
  }

  @Post(':id/subjects')
  addSubject(@Param('id') id: string, @Body() dto: ExamSubject, @CurrentUser() user: RequestUser) {
    return this.examinationsService.addSubject(id, dto, user);
  }

  @Delete(':id/subjects/:subjectId')
  removeSubject(@Param('id') id: string, @Param('subjectId') subjectId: string, @CurrentUser() user: RequestUser) {
    return this.examinationsService.removeSubject(id, subjectId, user);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.examinationsService.findOne(
      id,
      user,
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExaminationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.examinationsService.update(
      id,
      dto,
      user,
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.examinationsService.remove(
      id,
      user,
    );
  }
}