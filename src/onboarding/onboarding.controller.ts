import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { OnboardingService } from './onboarding.service';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

import { CreateSchoolOnboardingDto } from './dto/create-onboarding.dto';
import { Roles } from '../auth/decorator/roles.decorator';

@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
  ) {}

  @Post('school')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  createSchool(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSchoolOnboardingDto,
  ) {
    return this.onboardingService.createSchool(
      user,
      dto,
    );
  }
}