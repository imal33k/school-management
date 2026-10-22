import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { EnrollmentService } from './enrollment.service';

import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentStatusDto } from './dto/update-enrollment-status.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

@Controller('enrollments')
export class EnrollmentController {
  constructor(
    private readonly enrollmentService: EnrollmentService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateEnrollmentDto,
  ) {
    return this.enrollmentService.create(
      user,
      dto,
    );
  }

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
  ) {
    return this.enrollmentService.findAll(
      user,
    );
  }

  @Get('class/:classId')
  findByClass(
    @CurrentUser() user: RequestUser,
    @Param('classId') classId: string,
  ) {
    return this.enrollmentService.findByClass(
      user,
      classId,
    );
  }

  @Get('student/:studentId')
  findByStudent(
    @CurrentUser() user: RequestUser,
    @Param('studentId') studentId: string,
  ) {
    return this.enrollmentService.findByStudent(
      user,
      studentId,
    );
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.enrollmentService.findOne(
      user,
      id,
    );
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateEnrollmentStatusDto,
  ) {
    return this.enrollmentService.updateStatus(
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
    return this.enrollmentService.remove(
      user,
      id,
    );
  }
}