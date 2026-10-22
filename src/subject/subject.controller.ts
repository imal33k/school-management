import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { SubjectsService } from './subject.service';

import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

@Controller('subject')
export class SubjectController {
  constructor(
    private readonly subjectService: SubjectsService,
  ) {}

  @Post()
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
  findAll(
    @CurrentUser() user: RequestUser,
  ) {
    return this.subjectService.findAll(user);
  }

  @Get(':id')
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