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
import { Roles } from '../auth/decorator/roles.decorator';
import { AttendanceService } from './attendance.service';
import { BulkAttendanceDto } from './dto/bulk-attendance.dto';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { AttendanceQueryDto } from './dto/attendance-query.dto';
import { UserRole } from '@prisma/client';
import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { RosterQueryDto } from './dto/roster-query.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';

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
  @Post('bulk')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  bulkMark(@Body() dto: BulkAttendanceDto,@CurrentUser() user: RequestUser){
    return this.attendanceService.bulkMark(dto, user);
  }

  @Get('me')
  findMine(@CurrentUser() user: RequestUser) { return this.attendanceService.findMine(user); }

  @Get('teacher/me')
  @Roles(UserRole.TEACHER)
  findTeacherAttendance(
    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.attendanceService.findTeacherAttendance(user, query);
  }

  @Get('teacher/me/classes/:classId')
  @Roles(UserRole.TEACHER)
  findTeacherClassAttendance(
    @Param('classId') classId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.attendanceService.findTeacherClassAttendance(
      classId,
      user,
      query,
    );
  }

  @Get('teacher/me/students/:studentId')
  @Roles(UserRole.TEACHER)
  findTeacherStudentAttendance(
    @Param('studentId') studentId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.attendanceService.findTeacherStudentAttendance(
      studentId,
      user,
      query,
    );
  }

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

  @Get('class/:classId/roster')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  getRoster(
    @Param('classId') classId: string,
    @Query() query: RosterQueryDto,
    @CurrentUser() user: RequestUser,
  ){
    return this.attendanceService.getRoster(classId, query.date,user);
  }

    @Get('class/:classId/summary')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  getClassSummary(
    @Param('classId') classId: string,
    @Query() query: SummaryQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.attendanceService.getClassSummary(
      classId,
      query.from,
      query.to,
      user,
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