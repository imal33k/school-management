import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';

import {
  GenerateReportCardsDto,
  PublishReportCardsDto,
  UpdateRemarksDto,
} from './dto/report-card.dto';
import { ReportCardsService } from './report-cards.service';

function pdfResponse(file: { buffer: Buffer; filename: string }) {
  return new StreamableFile(file.buffer, {
    type: 'application/pdf',
    disposition: `inline; filename="${file.filename}"`,
  });
}

@Controller('report-cards')
export class ReportCardsController {
  constructor(private readonly reportCardsService: ReportCardsService) {}

  // Work out totals, averages and positions for a class (draft cards)
  @Post('generate')
  @Roles(UserRole.SCHOOL_ADMIN)
  generate(
    @Body() dto: GenerateReportCardsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportCardsService.generate(dto, user);
  }

  // Lock the results and make the cards visible to students and parents
  @Post('publish')
  @Roles(UserRole.SCHOOL_ADMIN)
  publish(
    @Body() dto: PublishReportCardsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportCardsService.publish(dto, user);
  }

  // The routes below with fixed words must stay ABOVE the ':id' routes.

  @Get('me')
  @Roles(UserRole.STUDENT, UserRole.PARENT)
  findMine(@CurrentUser() user: RequestUser) {
    return this.reportCardsService.findMine(user);
  }

  @Get('examination/:examinationId')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  listForExamination(
    @Param('examinationId') examinationId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportCardsService.listForExamination(examinationId, user);
  }

  @Get('examination/:examinationId/pdf')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  async classPdf(
    @Param('examinationId') examinationId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return pdfResponse(
      await this.reportCardsService.getClassPdf(examinationId, user),
    );
  }

  @Get(':id')
  @Roles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT,
  )
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.reportCardsService.findOne(id, user);
  }

  @Get(':id/pdf')
  @Roles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT,
  )
  async cardPdf(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return pdfResponse(await this.reportCardsService.getCardPdf(id, user));
  }

  @Patch(':id/remarks')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  updateRemarks(
    @Param('id') id: string,
    @Body() dto: UpdateRemarksDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reportCardsService.updateRemarks(id, dto, user);
  }
}
