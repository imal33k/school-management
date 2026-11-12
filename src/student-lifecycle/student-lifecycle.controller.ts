import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, type RequestUser } from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';
import { uploadInterceptor, type UploadedFileLike } from '../common/uploaded-file';

import { csvTextFrom } from './csv-upload';
import {
  ChangeClassDto,
  PromoteDto,
  PromotionPreviewQueryDto,
  TransferOutDto,
} from './dto/lifecycle.dto';
import { csvTemplate } from './student-import.logic';
import { StudentLifecycleService } from './student-lifecycle.service';

@Controller('student-lifecycle')
export class StudentLifecycleController {
  constructor(private readonly service: StudentLifecycleService) {}

  // ---------- Promotion ----------

  // Who is in a class, how they did, and what we suggest for each
  @Get('promotions/preview')
  @Roles(UserRole.SCHOOL_ADMIN)
  preview(@Query() query: PromotionPreviewQueryDto, @CurrentUser() user: RequestUser) {
    return this.service.preview(query, user);
  }

  // Promote, repeat, graduate or transfer out a group of students
  @Post('promotions')
  @Roles(UserRole.SCHOOL_ADMIN)
  promote(@Body() dto: PromoteDto, @CurrentUser() user: RequestUser) {
    return this.service.promote(dto, user);
  }

  // ---------- CSV import ----------

  @Get('import/template')
  @Roles(UserRole.SCHOOL_ADMIN)
  template() {
    return new StreamableFile(Buffer.from(csvTemplate(), 'utf8'), {
      type: 'text/csv',
      disposition: 'attachment; filename="students-template.csv"',
    });
  }

  // Add ?dryRun=true to only check the file without importing anything
  @Post('import')
  @Roles(UserRole.SCHOOL_ADMIN)
  @UseInterceptors(uploadInterceptor('file', 2 * 1024 * 1024))
  importStudents(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Query('dryRun') dryRun: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.importStudents(csvTextFrom(file), dryRun === 'true', user);
  }

  // ---------- One student ----------

  @Post(':studentId/change-class')
  @Roles(UserRole.SCHOOL_ADMIN)
  changeClass(
    @Param('studentId') studentId: string,
    @Body() dto: ChangeClassDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.changeClass(studentId, dto, user);
  }

  @Post(':studentId/transfer-out')
  @Roles(UserRole.SCHOOL_ADMIN)
  transferOut(
    @Param('studentId') studentId: string,
    @Body() dto: TransferOutDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.transferOut(studentId, dto, user);
  }

  @Get(':studentId/history')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT)
  history(@Param('studentId') studentId: string, @CurrentUser() user: RequestUser) {
    return this.service.history(studentId, user);
  }
}
