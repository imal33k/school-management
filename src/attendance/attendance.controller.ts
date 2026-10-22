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

import { AttendanceService } from './attendance.service';

import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { AttendanceQueryDto } from './dto/attendance-query.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateAttendanceDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attendanceService.create(
      dto,
      user,
    );
  }

  @Get('me')
  findMine(@CurrentUser() user: RequestUser) { return this.attendanceService.findMine(user); }

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.attendanceService.findAll(
      user,
      query.date,
    );
  }

  @Get('class/:classId')
  findByClass(
    @Param('classId') classId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.attendanceService.findByClass(
      classId,
      user,
      query.date,
    );
  }

  @Get('student/:studentId')
  findByStudent(
    @Param('studentId') studentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attendanceService.findByStudent(
      studentId,
      user,
    );
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attendanceService.findOne(
      id,
      user,
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAttendanceDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attendanceService.update(
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
    return this.attendanceService.remove(
      id,
      user,
    );
  }
}