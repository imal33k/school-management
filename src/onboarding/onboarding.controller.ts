import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import { OnboardingService } from './onboarding.service';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

import { CreateSchoolOnboardingDto } from './dto/create-onboarding.dto';

@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
  ) {}

  @Post('school')
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