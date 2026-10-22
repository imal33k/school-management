import {
  Controller,
  Get,
} from '@nestjs/common';

import { SuperAdminService } from './super-admin.service';

import {
  CurrentUser,
 type RequestUser,
} from '../auth/decorator/current-user.decorator';

@Controller('super-admin')
export class SuperAdminController {
  constructor(
    private readonly superAdminService: SuperAdminService,
  ) {}

  @Get('dashboard')
  getDashboard(
    @CurrentUser() user: RequestUser,
  ) {
    return this.superAdminService.getDashboard(
      user,
    );
  }
}