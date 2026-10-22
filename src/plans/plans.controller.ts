import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { PlansService } from './plans.service';

import { CreatePlanDto } from './dto/create-plan-status.dto';
import { UpdatePlanDto } from './dto/update-plan-status.dto';

import {
  CurrentUser,
 type RequestUser,
} from '../auth/decorator/current-user.decorator';

@Controller('plans')
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
  ) {}

  @Post()
  create(
    @Body() dto: CreatePlanDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.plansService.create(
      dto,
      user,
    );
  }

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
  ) {
    return this.plansService.findAll(
      user,
    );
  }

  @Get('active')
  findActivePlans() {
    return this.plansService.findActivePlans();
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.plansService.findOne(
      id,
      user,
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.plansService.update(
      id,
      dto,
      user,
    );
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.plansService.updateStatus(
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
    return this.plansService.remove(
      id,
      user,
    );
  }
}