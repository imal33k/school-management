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

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';

import {
  CreateGradeScaleDto,
  UpdateGradeScaleDto,
} from './dto/grade-scale.dto';
import { GradingService } from './grading.service';

@Controller('grading/scales')
export class GradingController {
  constructor(private readonly gradingService: GradingService) {}

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN)
  create(@Body() dto: CreateGradeScaleDto, @CurrentUser() user: RequestUser) {
    return this.gradingService.create(dto, user);
  }

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  findAll(@CurrentUser() user: RequestUser) {
    return this.gradingService.findAll(user);
  }

  // Must stay ABOVE ':id', otherwise "effective" would be read as an id.
  @Get('effective')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  getEffective(@CurrentUser() user: RequestUser) {
    return this.gradingService.getEffective(user);
  }

  @Get(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.gradingService.findOne(id, user);
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateGradeScaleDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.gradingService.update(id, dto, user);
  }

  @Patch(':id/default')
  @Roles(UserRole.SCHOOL_ADMIN)
  setDefault(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.gradingService.setDefault(id, user);
  }

  @Delete(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.gradingService.remove(id, user);
  }
}