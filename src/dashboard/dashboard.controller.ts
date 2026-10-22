import {
  Controller,
  Get, Query,
} from '@nestjs/common';

import { DashboardService } from './dashboard.service';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';
import { DashboardAggregateQueryDto } from './dto/dashboard-aggregate-query.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
  ) {}

  @Get('aggregates')
  getAggregates(@CurrentUser() user: RequestUser, @Query() query: DashboardAggregateQueryDto) {
    return this.dashboardService.getAggregates(user, query);
  }

  @Get()
  getDashboard(
    @CurrentUser() user: RequestUser,
  ) {
    return this.dashboardService.getDashboard(
      user,
    );
  }
}