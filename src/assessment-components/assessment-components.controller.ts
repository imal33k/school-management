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

import { AssessmentComponentsService } from './assessment-components.service';
import {
  CreateAssessmentComponentDto,
  UpdateAssessmentComponentDto,
} from './dto/assessment-component.dto';

@Controller('assessment-components')
export class AssessmentComponentsController {
  constructor(private readonly service: AssessmentComponentsService) {}

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  findAll(@CurrentUser() user: RequestUser) {
    return this.service.findAll(user);
  }

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN)
  create(
    @Body() dto: CreateAssessmentComponentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.create(dto, user);
  }

  // Sets up "CA 40 + Exam 60" for a school that has no components yet
  @Post('defaults')
  @Roles(UserRole.SCHOOL_ADMIN)
  createDefaults(@CurrentUser() user: RequestUser) {
    return this.service.createDefaults(user);
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAssessmentComponentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }
}