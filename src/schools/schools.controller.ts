import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import {
  SchoolStatus,
} from '@prisma/client';

import { SchoolsService } from './schools.service';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { CreatePaystackSubaccountDto } from './dto/create-paystack-subaccount.dto';
import { Roles } from '../auth/decorator/roles.decorator';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

@Controller('schools')
export class SchoolsController {
  constructor(
    private readonly schoolsService: SchoolsService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
  ) {
    return this.schoolsService.findAll(
      user,
    );
  }

  @Get('me')
  findMine(
    @CurrentUser() user: RequestUser,
  ) {
    return this.schoolsService.findMine(
      user,
    );
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.schoolsService.findOne(
      id,
      user,
    );
  }

  @Patch('me')
  @Roles(UserRole.SCHOOL_ADMIN)
  updateMine(
    @Body() dto: UpdateSchoolDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.schoolsService.updateMine(
      dto,
      user,
    );
  }

  @Post('me/paystack-subaccount')
  @Roles(UserRole.SCHOOL_ADMIN)
  createPaystackSubaccount(
    @Body() dto: CreatePaystackSubaccountDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.schoolsService.createPaystackSubaccount(dto, user);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: SchoolStatus,
    @CurrentUser() user: RequestUser,
  ) {
    return this.schoolsService.updateStatus(
      id,
      status,
      user,
    );
  }
}